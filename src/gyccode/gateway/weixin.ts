// gyc 消息网关：微信 iLink bot 协议实现（MVP）
// 协议要点逆向自 hermes v0.20.5 gateway/platforms/weixin.py 并经本机实测验证：
// - base: https://ilinkai.weixin.qq.com，Bearer token 认证
// - 发送必须携带 context_token（用户向 bot 发消息后由服务端下发），过期报 ret=-2 "prepare failed"
// - 收信走 getupdates 长轮询，游标 get_updates_buf 断点续传；消息顶层 context_token 即新凭证
import { mkdir, readFile, writeFile } from "node:fs/promises"
import { homedir } from "node:os"
import { join } from "node:path"
import process from "node:process"
import type { GatewayAdapter, GatewayMessage, GatewaySendResult } from "./adapter"
import { classifyIlinkResponse, GatewayError } from "./errors"

const ILINK_BASE_URL = "https://ilinkai.weixin.qq.com"
const CHANNEL_VERSION = "2.2.0"
const CLIENT_VERSION = String((2 << 16) | (2 << 8) | 0)
const ENDPOINT_SEND = "ilink/bot/sendmessage"
const ENDPOINT_POLL = "ilink/bot/getupdates"
const LONG_POLL_TIMEOUT_MS = 35_000
const SEND_TIMEOUT_MS = 15_000
const MAX_MESSAGE_LENGTH = 2000
const MSG_TYPE_BOT = 2
const MSG_STATE_FINISH = 2
const ITEM_TEXT = 1

export const WEIXIN_DATA_DIR = join(homedir(), ".gyc", "data", "weixin")

interface WeixinConfig {
  token: string
  accountId: string
  baseUrl: string
  homeChannel?: string
}

const configError = () =>
  new GatewayError("unknown", "请在 ~/.gyc/.env 配置 GYC_WEIXIN_TOKEN 与 GYC_WEIXIN_ACCOUNT_ID 后重试")

/** 从环境变量解析配置（~/.gyc/.env 由 CLI 入口预加载）。缺失即抛 GatewayError。 */
export function resolveWeixinConfig(): WeixinConfig {
  const token = process.env.GYC_WEIXIN_TOKEN ?? ""
  const accountId = process.env.GYC_WEIXIN_ACCOUNT_ID ?? ""
  if (!token || !accountId) throw configError()
  return {
    token,
    accountId,
    baseUrl: (process.env.GYC_WEIXIN_BASE_URL || ILINK_BASE_URL).replace(/\/+$/, ""),
    homeChannel: process.env.GYC_WEIXIN_HOME_CHANNEL || undefined,
  }
}

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms))

async function readJson<T>(file: string): Promise<T | undefined> {
  const raw = await readFile(join(WEIXIN_DATA_DIR, file), "utf-8").catch(() => undefined)
  if (!raw) return undefined
  return JSON.parse(raw) as T
}

async function writeJson(file: string, data: unknown): Promise<void> {
  await mkdir(WEIXIN_DATA_DIR, { recursive: true })
  await writeFile(join(WEIXIN_DATA_DIR, file), JSON.stringify(data, null, 2), "utf-8")
}

function randomUin(): string {
  const value = new Uint32Array(1)
  crypto.getRandomValues(value)
  return Buffer.from(String(value[0]).padStart(10, "0")).toString("base64")
}

function buildHeaders(token: string, body: string): Record<string, string> {
  return {
    "Content-Type": "application/json",
    AuthorizationType: "ilink_bot_token",
    "Content-Length": String(Buffer.byteLength(body, "utf-8")),
    "X-WECHAT-UIN": randomUin(),
    "iLink-App-Id": "bot",
    "iLink-App-ClientVersion": CLIENT_VERSION,
    Authorization: `Bearer ${token}`,
  }
}

async function apiPost(config: WeixinConfig, endpoint: string, payload: unknown, timeoutMs: number): Promise<Record<string, unknown>> {
  const body = JSON.stringify({ ...(payload as object), base_info: { channel_version: CHANNEL_VERSION } })
  const response = await fetch(`${config.baseUrl}/${endpoint}`, {
    method: "POST",
    headers: buildHeaders(config.token, body),
    body,
    signal: AbortSignal.timeout(timeoutMs),
  }).catch((cause: unknown) => {
    throw new GatewayError("network", `请求 ${endpoint} 失败: ${String(cause)}`)
  })
  const raw = await response.text()
  if (!response.ok) throw new GatewayError("network", `${endpoint} HTTP ${response.status}: ${raw.slice(0, 200)}`)
  return JSON.parse(raw) as Record<string, unknown>
}

/** 按 hermes 实证语义切分超长文本（微信单条上限 2000 字符）。 */
export function splitWeixinText(text: string, limit = MAX_MESSAGE_LENGTH): string[] {
  if (text.length <= limit) return [text]
  const chunks: string[] = []
  let rest = text
  while (rest.length > limit) {
    chunks.push(rest.slice(0, limit))
    rest = rest.slice(limit)
  }
  if (rest) chunks.push(rest)
  return chunks
}

/** 心跳与陈旧进程检测：同一 bot token 不应被两个进程并发使用（hermes 孤儿网关教训）。 */
async function recordHeartbeat(): Promise<string | null> {
  const previous = await readJson<{ pid: number; ts: number }>("heartbeat.json")
  const stale = previous && previous.pid !== process.pid && heartbeatPidAlive(previous.pid) ? `PID ${previous.pid}` : null
  await writeJson("heartbeat.json", { pid: process.pid, ts: Date.now() })
  return stale
}

function heartbeatPidAlive(pid: number): boolean {
  // ESRCH＝进程已不存在；其余异常（如 EPERM）视为存活处理
  try {
    process.kill(pid, 0)
    return true
  } catch {
    return false
  }
}

export class WeixinAdapter implements GatewayAdapter {
  readonly platform = "weixin"
  private config?: WeixinConfig
  private running = false

  async connect(): Promise<void> {
    this.config = resolveWeixinConfig()
    // 轻量连通性校验交给首次收发；此处仅确保数据目录就绪。
    await mkdir(WEIXIN_DATA_DIR, { recursive: true }).catch(() => undefined)
  }

  /** 读取指定会话的回复凭证。 */
  private async contextToken(chatId: string): Promise<string | undefined> {
    const store = await readJson<Record<string, string>>("context-tokens.json")
    return store?.[chatId]
  }

  /** 持久化回复凭证（收到对端消息或发送成功后调用）。 */
  private async saveContextToken(chatId: string, token: string): Promise<void> {
    const store = (await readJson<Record<string, string>>("context-tokens.json")) ?? {}
    store[chatId] = token
    await writeJson("context-tokens.json", store)
  }

  async sendText(chatId: string, text: string): Promise<GatewaySendResult> {
    if (!this.config) return { ok: false, error: "适配器未连接", kind: "unknown" }
    const config = this.config
    let lastError: GatewayError | undefined
    let lastMessageId = ""
    for (const chunk of splitWeixinText(text)) {
      const message: Record<string, unknown> = {
        from_user_id: "",
        to_user_id: chatId,
        client_id: crypto.randomUUID(),
        message_type: MSG_TYPE_BOT,
        message_state: MSG_STATE_FINISH,
        item_list: [{ type: ITEM_TEXT, text_item: { text: chunk } }],
      }
      const ctxToken = await this.contextToken(chatId)
      if (ctxToken) message.context_token = ctxToken
      const response = await apiPost(config, ENDPOINT_SEND, { msg: message }, SEND_TIMEOUT_MS).catch(
        (cause: GatewayError) => cause,
      )
      if (response instanceof GatewayError) {
        lastError = response
        break
      }
      const failure = classifyIlinkResponse(
        response.ret as number | undefined,
        response.errcode as number | undefined,
        String(response.errmsg ?? ""),
      )
      if (failure) {
        lastError = failure
        break
      }
      lastMessageId = String(response.message_id ?? "")
    }
    if (lastError) return { ok: false, error: lastError.message, kind: lastError.kind }
    const stale = await recordHeartbeat().catch(() => null)
    if (stale) console.warn(`[gyc] 注意：检测到另一存活进程 ${stale} 亦在使用本 bot 凭证，存在消息竞争风险`)
    return { ok: true, messageId: lastMessageId || `gyc-weixin-${Date.now().toString(16)}` }
  }

  async poll(onMessage: (message: GatewayMessage) => Promise<void>, abort: AbortSignal): Promise<void> {
    if (!this.config) throw new GatewayError("unknown", configError().message)
    this.running = true
    let syncBuf = ((await readJson<{ buf?: string }>("sync-buf.json"))?.buf) ?? ""
    while (this.running && !abort.aborted) {
      const response = await apiPost(this.config, ENDPOINT_POLL, { get_updates_buf: syncBuf }, LONG_POLL_TIMEOUT_MS + 5_000).catch(
        (cause: GatewayError) => cause,
      )
      if (response instanceof GatewayError) {
        if (abort.aborted) break
        await sleep(2_000)
        continue
      }
      const failure = classifyIlinkResponse(
        response.ret as number | undefined,
        response.errcode as number | undefined,
        String(response.errmsg ?? ""),
      )
      if (failure?.kind === "session_expired") throw failure
      const nextBuf = String(response.get_updates_buf ?? "")
      if (nextBuf && nextBuf !== syncBuf) {
        syncBuf = nextBuf
        await writeJson("sync-buf.json", { buf: syncBuf }).catch(() => undefined)
      }
      for (const raw of (response.msgs as Array<Record<string, unknown>> | undefined) ?? []) {
        const senderId = String(raw.from_user_id ?? raw.sender_id ?? "")
        const ctxToken = String(raw.context_token ?? "").trim()
        if (senderId && ctxToken) await this.saveContextToken(senderId, ctxToken).catch(() => undefined)
        const items = (raw.item_list as Array<Record<string, unknown>> | undefined) ?? []
        const text = items
          .map((item) => String((item.text_item as Record<string, unknown> | undefined)?.text ?? ""))
          .filter(Boolean)
          .join("\n")
        if (!text || !senderId) continue
        await onMessage({ from: senderId, text, timestamp: Date.now() })
      }
    }
  }

  async disconnect(): Promise<void> {
    this.running = false
  }
}
