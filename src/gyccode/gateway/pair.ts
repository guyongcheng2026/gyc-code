// gyc 消息网关：微信 iLink bot QR 扫码配对（协议移植自 hermes v0.20.5 qr_login）
// 流程：get_bot_qrcode 取码 → 终端渲染 → 微信扫码确认 → get_qrcode_status 轮询至 confirmed
// → 产出 {account_id, token, baseUrl, homeChannel} 四元凭据，由调用方落盘。
import QRCode from "qrcode"
import process from "node:process"

const ILINK_BASE_URL = "https://ilinkai.weixin.qq.com"
const CLIENT_VERSION = String((2 << 16) | (2 << 8) | 0)
const POLL_INTERVAL_MS = 1_000
const TOTAL_TIMEOUT_MS = 8 * 60_000
const MAX_QR_REFRESH = 3

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms))

export interface PairCredential {
  accountId: string
  token: string
  baseUrl: string
  homeChannel: string
}

function apiHeaders(): Record<string, string> {
  return {
    "iLink-App-Id": "bot",
    "iLink-App-ClientVersion": CLIENT_VERSION,
  }
}

async function apiGet(base: string, endpoint: string): Promise<Record<string, unknown>> {
  const response = await fetch(`${base}/${endpoint}`, { headers: apiHeaders(), signal: AbortSignal.timeout(35_000) })
  if (!response.ok) throw new Error(`GET ${endpoint} HTTP ${response.status}`)
  return (await response.json()) as Record<string, unknown>
}

async function renderQr(scanData: string): Promise<string> {
  return QRCode.toString(scanData, { type: "terminal", small: true })
}

/** 阻塞式扫码配对：成功返回凭据；超时/多次过期抛错。onQr 在每次出码时回调完整扫码链接。 */export async function pairWeixin(
  log: (line: string) => void,
  onQr?: (scanData: string) => Promise<void> | void,
): Promise<PairCredential> {
  let base = ILINK_BASE_URL
  let qrcodeValue = ""
  let refreshCount = 0
  const deadline = Date.now() + TOTAL_TIMEOUT_MS

  const fetchQr = async (): Promise<void> => {
    const resp = await apiGet(base, "ilink/bot/get_bot_qrcode?bot_type=3")
    qrcodeValue = String(resp.qrcode ?? "")
    const imgUrl = String(resp.qrcode_img_content ?? "")
    if (!qrcodeValue) throw new Error("iLink 未返回 qrcode 凭证")
    // 微信须扫完整 liteapp URL，而非裸 hex token
    const scanData = imgUrl || qrcodeValue
    if (onQr) await onQr(scanData)
    log("请使用微信扫描屏幕上的二维码：")
    try {
      log(await renderQr(scanData))
    } catch {
      log(`终端渲染失败；扫码链接：${scanData}`)
    }
  }

  await fetchQr()
  while (Date.now() < deadline) {
    let statusResp: Record<string, unknown>
    try {
      statusResp = await apiGet(base, `ilink/bot/get_qrcode_status?qrcode=${encodeURIComponent(qrcodeValue)}`)
    } catch {
      await sleep(POLL_INTERVAL_MS)
      continue
    }
    const status = String(statusResp.status ?? "wait")
    if (status === "wait") {
      process.stdout.write(".")
    } else if (status === "scaned") {
      log("已扫码，请在微信里确认…")
    } else if (status === "scaned_but_redirect") {
      const host = String(statusResp.redirect_host ?? "")
      if (host) base = `https://${host}`
    } else if (status === "expired") {
      refreshCount += 1
      if (refreshCount > MAX_QR_REFRESH) throw new Error("二维码多次过期，配对终止")
      log(`二维码已过期，正在刷新… (${refreshCount}/${MAX_QR_REFRESH})`)
      await fetchQr()
    } else if (status === "confirmed") {
      const accountId = String(statusResp.ilink_bot_id ?? "")
      const token = String(statusResp.bot_token ?? "")
      const baseUrl = String(statusResp.baseurl ?? ILINK_BASE_URL)
      const homeChannel = String(statusResp.ilink_user_id ?? "")
      if (!accountId || !token) throw new Error("配对确认但凭据不完整")
      log(`微信连接成功，account_id=${accountId}`)
      return { accountId, token, baseUrl, homeChannel }
    }
    await sleep(POLL_INTERVAL_MS)
  }
  throw new Error("扫码配对超时")
}
