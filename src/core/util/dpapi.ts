/**
 * Windows DPAPI（crypt32 CryptProtectData / CryptUnprotectData）封装：
 * 用于凭据（API key / OAuth token）落盘加密。密钥由 Windows 绑定当前
 * 用户派生，数据库文件被其他账户或离线拷贝后无法解密。
 *
 * 密文格式：`dpapi.v1:` + base64(protected bytes)。读取侧见到前缀即解密；
 * 无前缀的历史明文数据原样返回（平滑迁移：凭据下次被重写时自动加密）。
 * 非 Windows 平台 protect/unprotect 均为恒等函数（保持明文，与旧行为一致）。
 */
import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto"
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs"
import { homedir } from "node:os"
import { dirname, join } from "node:path"
import { platform } from "node:process"

export const DPAPI_PREFIX = "dpapi.v1:"

// 非 Windows 平台的兜底加密：无 DPAPI 时改用本机密钥文件的 AES-256-GCM，
// 至少避免凭据以明文进入备份/云同步/日志。密钥文件 0600，仅本用户可读，
// 因此它挡不住"同用户进程读取密钥后再解密"，但显著缩小明文暴露面。
export const FALLBACK_PREFIX = "fallback.v1:"

let fallbackKeyCache: Buffer | null | undefined

function fallbackKeyPath() {
  const base = process.env.GYCCODE_MEMORY_HOME || process.env.HERMES_HOME || join(homedir(), ".gyc")
  return join(base, "secret.key")
}

function loadFallbackKey(): Buffer | undefined {
  if (fallbackKeyCache !== undefined) return fallbackKeyCache ?? undefined
  try {
    const file = fallbackKeyPath()
    mkdirSync(dirname(file), { recursive: true })
    if (existsSync(file)) {
      const key = Buffer.from(readFileSync(file, "utf8").trim(), "hex")
      fallbackKeyCache = key.length === 32 ? key : null
      return fallbackKeyCache ?? undefined
    }
    const key = randomBytes(32)
    writeFileSync(file, key.toString("hex"), { mode: 0o600 })
    fallbackKeyCache = key
    return key
  } catch {
    // 无写权限等情况下退回明文（保持旧行为，绝不因此崩溃）
    fallbackKeyCache = null
    return undefined
  }
}

function fallbackProtect(plain: string): string | undefined {
  const key = loadFallbackKey()
  if (!key) return undefined
  try {
    const iv = randomBytes(12)
    const cipher = createCipheriv("aes-256-gcm", key, iv)
    const encrypted = Buffer.concat([cipher.update(plain, "utf8"), cipher.final()])
    return FALLBACK_PREFIX + Buffer.concat([iv, cipher.getAuthTag(), encrypted]).toString("base64")
  } catch {
    return undefined
  }
}

function fallbackUnprotect(value: string): string | undefined {
  const key = loadFallbackKey()
  if (!key) return undefined
  try {
    const raw = Buffer.from(value.slice(FALLBACK_PREFIX.length), "base64")
    const iv = raw.subarray(0, 12)
    const tag = raw.subarray(12, 28)
    const decipher = createDecipheriv("aes-256-gcm", key, iv)
    decipher.setAuthTag(tag)
    return Buffer.concat([decipher.update(raw.subarray(28)), decipher.final()]).toString("utf8")
  } catch {
    return undefined
  }
}

type Api = {
  readonly protect: (plain: string) => string
  readonly unprotect: (cipher: string) => string
}

// 防 GC 池：Bun 1.3.14 (win) 存在 NAPI finalizer 崩溃 bug —— koffi 创建的
// native 包装对象（library/func/struct/decode 结果）被 GC 回收时在 finalizer
// 里调用 napi_reference_unref 会 panic 整个进程（发送消息→读凭据→必崩）。
// 规避：所有 koffi 对象在进程生命周期内保持强引用，finalizer 永不触发。
// 池增长量 = 每次调用几十字节且解密结果另有 LRU 缓存，可忽略。
const keepAlive: unknown[] = []

// 解密结果 LRU：同一密文重复解密（每次 LLM 请求读凭据）直接命中，减少 DPAPI 调用与池增长
const unprotectCache = new Map<string, string>()
const UNPROTECT_CACHE_MAX = 128

let cached: Api | undefined | null

function load(): Api | undefined {
  if (platform !== "win32") return undefined
  if (cached !== undefined) return cached === null ? undefined : cached
  cached = init()
  return cached ?? undefined
}

function init(): Api | undefined {
  try {
    // 延迟 require：非 win32 构建不引入原生模块解析开销
    const koffi = require("koffi") as typeof import("koffi")
    const crypt32 = koffi.load("crypt32.dll")
    const kernel32 = koffi.load("kernel32.dll")

    const BLOB = koffi.struct("DpapiBlob", { cbSize: "uint32_t", pBlobData: "uint8_t *" })
    const CRYPTPROTECT_UI_FORBIDDEN = 0x1

    const protectFn = crypt32.func(
      "int32_t __stdcall CryptProtectData(_In_ DpapiBlob *in, const char16_t *descr, void *entropy, void *reserved, void *prompt, uint32_t flags, _Out_ DpapiBlob *out)",
    )
    const unprotectFn = crypt32.func(
      "int32_t __stdcall CryptUnprotectData(_In_ DpapiBlob *in, void *descr, void *entropy, void *reserved, void *prompt, uint32_t flags, _Out_ DpapiBlob *out)",
    )
    const localFree = kernel32.func("void * __stdcall LocalFree(void *mem)")

    // koffi 句柄对象全部池化防 GC（见文件头注释）
    keepAlive.push(koffi, crypt32, kernel32, BLOB, protectFn, unprotectFn, localFree)

    const protect = (plain: string) => {
      const buf = Buffer.from(plain, "utf8")
      const input = { cbSize: buf.length, pBlobData: buf }
      const output = { cbSize: 0, pBlobData: null }
      keepAlive.push(buf, input, output)
      const ok = protectFn(input, null, null, null, null, CRYPTPROTECT_UI_FORBIDDEN, output)
      if (!ok || !output.pBlobData || output.cbSize === 0) throw new Error("CryptProtectData failed")
      try {
        const bytes = koffi.decode(output.pBlobData, "uint8_t", output.cbSize) as Uint8Array
        keepAlive.push(bytes)
        return DPAPI_PREFIX + Buffer.from(bytes).toString("base64")
      } finally {
        localFree(output.pBlobData)
      }
    }

    const unprotect = (cipher: string) => {
      const buf = Buffer.from(cipher.slice(DPAPI_PREFIX.length), "base64")
      const input = { cbSize: buf.length, pBlobData: buf }
      const output = { cbSize: 0, pBlobData: null }
      keepAlive.push(buf, input, output)
      const ok = unprotectFn(input, null, null, null, null, CRYPTPROTECT_UI_FORBIDDEN, output)
      if (!ok || !output.pBlobData || output.cbSize === 0) throw new Error("CryptUnprotectData failed")
      try {
        const bytes = koffi.decode(output.pBlobData, "uint8_t", output.cbSize) as Uint8Array
        keepAlive.push(bytes)
        return Buffer.from(bytes).toString("utf8")
      } finally {
        localFree(output.pBlobData)
      }
    }

    return { protect, unprotect }
  } catch {
    return undefined
  }
}

/**
 * 加密机密字符串：win32 可用时返回 `dpapi.v1:` 前缀密文；其他平台走
 * `fallback.v1:`（AES-256-GCM + 本机密钥文件）；两者都不可用时原样返回。
 */
export function protectSecret(plain: string): string {
  if (plain.startsWith(DPAPI_PREFIX) || plain.startsWith(FALLBACK_PREFIX)) return plain
  const api = load()
  if (api) return api.protect(plain)
  return fallbackProtect(plain) ?? plain
}

/**
 * 解密机密字符串：`dpapi.v1:` 前缀解密（失败抛错，由调用方决定丢弃该
 * 凭据）；`fallback.v1:` 前缀用本机密钥解密；无前缀按历史明文原样返回。
 */
export function unprotectSecret(value: string): string {
  if (value.startsWith(FALLBACK_PREFIX)) return fallbackUnprotect(value) ?? value
  if (!value.startsWith(DPAPI_PREFIX)) return value
  const hit = unprotectCache.get(value)
  if (hit !== undefined) {
    // LRU 淘汰：命中即重插到末尾
    unprotectCache.delete(value)
    unprotectCache.set(value, hit)
    return hit
  }
  const api = load()
  if (!api) throw new Error("DPAPI cipher found but crypt32 unavailable")
  const plain = api.unprotect(value)
  if (unprotectCache.size >= UNPROTECT_CACHE_MAX) {
    const oldest = unprotectCache.keys().next().value
    if (oldest !== undefined) unprotectCache.delete(oldest)
  }
  unprotectCache.set(value, plain)
  return plain
}

export * as DPAPI from "./dpapi"
