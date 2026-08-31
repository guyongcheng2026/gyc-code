/**
 * 429 限流退避重试 fetch 包装器（客户端容错层）。
 *
 * 服务端限流中间件（src/server/middleware/rate-limit）在令牌耗尽时返回
 * 429 + retry-after 头。已配置 ServerAuth 密码的部署里，客户端在启动并发
 * 洪峰（init 握手 10+ 请求）或瞬时集中调用时可能撞上令牌桶低谷；单个请求
 * 失败不应让上层（TUI 主进程）进入致命错误路径——按 retry-after 退避重试一次。
 *
 * 仅对幂等请求（GET/HEAD）重试：非幂等请求（POST/PUT/...）即使被限流也要
 * 把 429 交给上层如实呈现（避免请求体重放造成重复副作用）。
 * SSE 事件流不走本包装（见 createSseClient / serverSentEvents.gen.js）。
 */
const MAX_RETRIES = 1
const DEFAULT_RETRY_AFTER_MS = 5000
const RETRY_AFTER_CEIL_MS = 30_000

export type RateLimitRetryFetch = (req: Request) => Promise<Response>

function retryAfterMs(response: Response): number {
  const header = response.headers.get("retry-after")
  if (!header) return DEFAULT_RETRY_AFTER_MS
  const seconds = Number(header)
  // retry-after 支持秒数与 HTTP-date 两种形式；本项目服务端只发整数秒，
  // 非数值（HTTP-date）场景兜底用默认 5s。
  if (Number.isFinite(seconds) && seconds >= 0) {
    return Math.min(seconds * 1000, RETRY_AFTER_CEIL_MS)
  }
  return DEFAULT_RETRY_AFTER_MS
}

export function wrapRateLimitRetry(fetchImpl: RateLimitRetryFetch): RateLimitRetryFetch {
  return async (req) => {
    const first = await fetchImpl(req)
    if (first.status !== 429 || (req.method !== "GET" && req.method !== "HEAD")) {
      return first
    }
    // 慢启动场景（如刚创建的限流桶）可能连续 429：最多重试 MAX_RETRIES 次，
    // 仍被限流就如实交给上层（错误可读，不再静默吞掉）。
    for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
      await new Promise((resolve) => setTimeout(resolve, retryAfterMs(first)))
      const retry = await fetchImpl(req)
      if (retry.status !== 429) return retry
    }
    return first
  }
}