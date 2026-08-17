/**
 * Windows DPAPI（crypt32 CryptProtectData / CryptUnprotectData）封装：
 * 用于凭据（API key / OAuth token）落盘加密。密钥由 Windows 绑定当前
 * 用户派生，数据库文件被其他账户或离线拷贝后无法解密。
 *
 * 密文格式：`dpapi.v1:` + base64(protected bytes)。读取侧见到前缀即解密；
 * 无前缀的历史明文数据原样返回（平滑迁移：凭据下次被重写时自动加密）。
 * 非 Windows 平台 protect/unprotect 均为恒等函数（保持明文，与旧行为一致）。
 */
import { platform } from "node:process"

export const DPAPI_PREFIX = "dpapi.v1:"

type Api = {
  readonly protect: (plain: string) => string
  readonly unprotect: (cipher: string) => string
}

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

    const protect = (plain: string) => {
      const buf = Buffer.from(plain, "utf8")
      const input = { cbSize: buf.length, pBlobData: buf }
      const output = { cbSize: 0, pBlobData: null }
      const ok = protectFn(input, null, null, null, null, CRYPTPROTECT_UI_FORBIDDEN, output)
      if (!ok || !output.pBlobData || output.cbSize === 0) throw new Error("CryptProtectData failed")
      try {
        const bytes = koffi.decode(output.pBlobData, "uint8_t", output.cbSize) as Uint8Array
        return DPAPI_PREFIX + Buffer.from(bytes).toString("base64")
      } finally {
        localFree(output.pBlobData)
      }
    }

    const unprotect = (cipher: string) => {
      const buf = Buffer.from(cipher.slice(DPAPI_PREFIX.length), "base64")
      const input = { cbSize: buf.length, pBlobData: buf }
      const output = { cbSize: 0, pBlobData: null }
      const ok = unprotectFn(input, null, null, null, null, CRYPTPROTECT_UI_FORBIDDEN, output)
      if (!ok || !output.pBlobData || output.cbSize === 0) throw new Error("CryptUnprotectData failed")
      try {
        const bytes = koffi.decode(output.pBlobData, "uint8_t", output.cbSize) as Uint8Array
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

/** 加密机密字符串：win32 可用时返回 `dpapi.v1:` 前缀密文，否则原样返回。 */
export function protectSecret(plain: string): string {
  if (plain.startsWith(DPAPI_PREFIX)) return plain
  const api = load()
  return api ? api.protect(plain) : plain
}

/**
 * 解密机密字符串：`dpapi.v1:` 前缀解密（失败抛错，由调用方决定丢弃该
 * 凭据）；无前缀按历史明文原样返回。
 */
export function unprotectSecret(value: string): string {
  if (!value.startsWith(DPAPI_PREFIX)) return value
  const api = load()
  if (!api) throw new Error("DPAPI cipher found but crypt32 unavailable")
  return api.unprotect(value)
}

export * as DPAPI from "./dpapi"
