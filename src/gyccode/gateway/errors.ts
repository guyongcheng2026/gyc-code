// gyc 消息网关：iLink 错误分类器
// 实证来源：hermes v0.20.5 排障（2026-08-25）——ret=-2 "prepare failed" 实为回复凭证过期，
// 若笼统归为限流会误导排查方向，故按 errmsg 细分。

export type GatewayErrorKind =
  | "credential_stale"
  | "session_expired"
  | "rate_limited"
  | "network"
  | "unknown"

const KIND_HINTS: Record<GatewayErrorKind, string> = {
  credential_stale: "回复凭证已失效。请在微信里给机器人发一条消息以刷新凭证，然后重试。",
  session_expired: "bot 会话已过期。请重新扫码登录配对后重试。",
  rate_limited: "触发服务端频率限制。请稍候约 1 分钟再试。",
  network: "网络请求失败。请检查本机网络与服务端连通性。",
  unknown: "未知错误。请携带原始响应信息进一步排查。",
}

export class GatewayError extends Error {
  readonly kind: GatewayErrorKind
  readonly hint: string
  readonly raw?: unknown

  constructor(kind: GatewayErrorKind, detail: string, raw?: unknown) {
    super(`${detail}（${KIND_HINTS[kind]}）`)
    this.name = "GatewayError"
    this.kind = kind
    this.hint = KIND_HINTS[kind]
    this.raw = raw
  }
}

export const gatewayError = (kind: GatewayErrorKind, detail: string, raw?: unknown) =>
  new GatewayError(kind, detail, raw)

/** 按 iLink 响应的 ret/errmsg 判定错误类别；返回 null 表示响应为成功语义。 */
export function classifyIlinkResponse(ret: number | undefined, errcode: number | undefined, errmsg: string): GatewayError | null {
  const code = ret ?? errcode ?? 0
  if (code === 0) return null
  const text = errmsg.toLowerCase()
  if (code === -14) return gatewayError("session_expired", `iLink 返回 ${code}: ${errmsg}`)
  if (code === -2 && text.includes("unknown error")) return gatewayError("session_expired", `iLink 返回 -2: ${errmsg}`)
  if (code === -2 && text.includes("prepare failed")) return gatewayError("credential_stale", `iLink 返回 -2: ${errmsg}`)
  if (code === -2) return gatewayError("rate_limited", `iLink 返回 -2: ${errmsg}`)
  return gatewayError("unknown", `iLink 返回 ${code}: ${errmsg}`, { ret, errcode, errmsg })
}
