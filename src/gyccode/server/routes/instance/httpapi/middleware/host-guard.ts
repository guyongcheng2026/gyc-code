import { Flag } from "@gyccode/core/flag/flag"
import { Effect } from "effect"
import { HttpRouter, HttpServerRequest, HttpServerResponse } from "effect/unstable/http"

// 未配置访问口令时，服务器默认只监听回环，鉴权整体旁路。此时 Host 头是唯一可信的边界信号：
// 恶意页面可把自己的域名解析到 127.0.0.1（DNS rebinding），其 Origin == Host == 攻击者域名，
// 于是 sameHost 判定放行、且无口令可校验，攻击者即可读写本机 API。
// 这里在未配置口令时强制要求 Host 为回环地址；已配置口令则交给鉴权层，不限制反代/自定义域名。
export function hostnameOfHostHeader(host: string | undefined): string | undefined {
  if (!host) return undefined
  if (host.startsWith("[")) {
    const end = host.indexOf("]")
    return end === -1 ? host : host.slice(0, end + 1)
  }
  const colon = host.lastIndexOf(":")
  return colon === -1 ? host : host.slice(0, colon)
}

// 严格 127.0.0.0/8 校验：不能用 startsWith("127.")，否则 "127.evil.com" /
// "127.0.0.1.evil.com" 这类攻击者 DNS 名（可解析到任意地址）也会被判为回环。
const isIpv4Loopback = (value: string): boolean => {
  const match = /^127\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(value)
  if (!match) return false
  return match.slice(1).every((part) => Number(part) <= 255)
}

export function isLoopbackHostname(hostname: string) {
  const value = hostname.toLowerCase()
  return (
    value === "localhost" ||
    isIpv4Loopback(value) ||
    value === "::1" ||
    value === "[::1]" ||
    value === "[::ffff:127.0.0.1]" ||
    value === "0:0:0:0:0:0:0:1"
  )
}

export const hostGuard = HttpRouter.middleware(
  (effect) =>
    Effect.gen(function* () {
      // 与 ServerAuth.required 判据一致：口令为空视为未配置
      if (Flag.GYCCODE_SERVER_PASSWORD) return yield* effect

      const request = yield* HttpServerRequest.HttpServerRequest
      const hostname = hostnameOfHostHeader(request.headers.host)
      // 无 Host 头（HTTP/1.0 或本地工具）不视为浏览器来源，放行
      if (!hostname || isLoopbackHostname(hostname)) return yield* effect

      yield* Effect.logError("Rejected request with non-loopback Host header while no server password is set", {
        host: request.headers.host,
        method: request.method,
      })
      return HttpServerResponse.empty({ status: 403 })
    }),
  { global: true },
)
