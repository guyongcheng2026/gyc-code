import { TooManyRequestsError } from "@gyccode/protocol/errors"
import { RateLimit } from "@gyccode/protocol/middleware/rate-limit"
import { Effect, Layer } from "effect"
import { HttpEffect, HttpServerRequest, HttpServerResponse } from "effect/unstable/http"

// ── 令牌桶参数 ──────────────────────────────────────────────
// 容量 240 突发 + 每秒 2 枚补充（≈120 req/分钟稳态）。
// 按请求方维度分桶：Basic 用户名，未认证请求记为 anonymous。
const CAPACITY = 240
const REFILL_PER_SECOND = 2
// 防内存无界：桶数超过上限时整体重置（本地/小团队场景 key 数极小，仅为防御）
const MAX_BUCKETS = 10_000

interface Bucket {
  tokens: number
  lastRefill: number
}

const buckets = new Map<string, Bucket>()

function take(key: string): boolean {
  const now = Date.now()
  const bucket = buckets.get(key) ?? { tokens: CAPACITY, lastRefill: now }
  const elapsedSeconds = (now - bucket.lastRefill) / 1000
  bucket.tokens = Math.min(CAPACITY, bucket.tokens + elapsedSeconds * REFILL_PER_SECOND)
  bucket.lastRefill = now
  if (buckets.size > MAX_BUCKETS) buckets.clear()
  const allowed = bucket.tokens >= 1
  if (allowed) bucket.tokens -= 1
  buckets.set(key, bucket)
  return allowed
}

function requesterFromRequest(request: HttpServerRequest.HttpServerRequest): string {
  const match = /^Basic\s+([A-Za-z0-9+/=]+)$/i.exec(request.headers.authorization ?? "")
  if (!match) return "anonymous"
  try {
    const decoded = Buffer.from(match[1]!, "base64").toString("utf8")
    const separator = decoded.indexOf(":")
    return separator === -1 ? "anonymous" : decoded.slice(0, separator)
  } catch {
    return "anonymous"
  }
}

export const rateLimitLayer = Layer.effect(
  RateLimit,
  Effect.gen(function* () {
    return RateLimit.of((effect) =>
      Effect.gen(function* () {
        const request = yield* HttpServerRequest.HttpServerRequest
        // WebSocket 升级（PTY 长连接）一次性建立后不再逐请求计费，豁免限流
        const isUpgrade = (request.headers.upgrade ?? "").toLowerCase() === "websocket"
        if (isUpgrade) return yield* effect
        if (take(requesterFromRequest(request))) return yield* effect
        yield* Effect.logWarning("rate limit exceeded", { requester: requesterFromRequest(request) })
        yield* HttpEffect.appendPreResponseHandler((_request, response) =>
          Effect.succeed(HttpServerResponse.setHeader(response, "retry-after", "5")),
        )
        return yield* new TooManyRequestsError({
          message: "请求过于频繁，请稍后重试",
          retryAfterSeconds: 5,
        })
      }),
    )
  }),
)
