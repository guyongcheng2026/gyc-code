import { TooManyRequestsError } from "@gyccode/protocol/errors"
import { RateLimit } from "@gyccode/protocol/middleware/rate-limit"
import { Effect, Layer } from "effect"
import { HttpEffect, HttpServerRequest, HttpServerResponse } from "effect/unstable/http"

// ── 令牌桶参数 ──────────────────────────────────────────────
// 容量 240 突发 + 每秒 2 枚补充（≈120 req/分钟稳态）。
// 按请求方维度分桶：Basic 用户名，未认证请求记为 anonymous。
// 注意：未配置 ServerAuth 时所有请求都是 anonymous 单桶（全局 2 req/s 稳态），
// 该场景仅适用于本机单人使用；多人共享部署必须配置鉴权，否则会互相挤兑。
const CAPACITY = 240
// 新 key 以小额度起步（之后按补充速率恢复至 CAPACITY）：合法新用户首秒 8 个
// 请求足够完成握手+首屏；攻击者轮换随机 Basic 用户名时每个新身份只有 8 枚，
// 无法再借"新桶即满桶"（CAPACITY 起步）绕过限流。
const NEW_KEY_TOKENS = 8
const REFILL_PER_SECOND = 2
// 防内存无界：桶数超过上限时按 LRU 淘汰最久未活跃的桶。
// 禁止整体 clear()——那会把所有真实用户的令牌恢复满桶，攻击者用随机
// Basic 用户名即可触发，等于一键绕过限流并 DoS 合法用户。
const MAX_BUCKETS = 10_000

interface Bucket {
  tokens: number
  lastRefill: number
}

const buckets = new Map<string, Bucket>()

function take(key: string): boolean {
  const now = Date.now()
  if (buckets.size >= MAX_BUCKETS) {
    // Map 迭代按插入序，首个即最久未触碰的桶（每次 take 都会 set 刷新位置）。
    const oldest = buckets.keys().next().value
    if (oldest !== undefined) buckets.delete(oldest)
  }
  const bucket = buckets.get(key) ?? { tokens: NEW_KEY_TOKENS, lastRefill: now }
  const elapsedSeconds = (now - bucket.lastRefill) / 1000
  bucket.tokens = Math.min(CAPACITY, bucket.tokens + elapsedSeconds * REFILL_PER_SECOND)
  bucket.lastRefill = now
  const allowed = bucket.tokens >= 1
  if (allowed) bucket.tokens -= 1
  // Map.set 对已存在 key 不会改变插入顺序，先 delete 再 set 才能把活跃桶
  // 移到尾部，维持"插入序 = 活跃度序"的 LRU 语义。
  buckets.delete(key)
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
        // WebSocket（PTY 长连接）建立后不逐帧计费，但握手请求本身与普通请求
        // 一样消耗 1 枚令牌——完全豁免会让伪造 Upgrade 头的握手洪水零成本
        // 绕过令牌桶。升级握手的特征判定统一在 authorization.ts 的
        // isWebSocketUpgrade（upgrade 头 + connection 头 + GET 方法），避免两处判定漂移。
        const requester = requesterFromRequest(request)
        if (take(requester)) return yield* effect
        yield* Effect.logWarning("rate limit exceeded", { requester })
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
