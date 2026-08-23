import { expect, test } from "bun:test"
import { Effect } from "effect"
import { RETRY_TOTAL_CAP_MS, actionFor, policy, retryable } from "./retry"
import { SessionV1 } from "@gyccode/core/v1/session"

test("stream idle timeout errors are retryable", () => {
  const error = {
    name: "UnknownError",
    data: {
      message:
        "LLM stream connection idle timeout: no data received within 600000ms. The connection may have dropped.",
    },
  }
  expect(retryable(error, "opencode")).toBeDefined()
})

// 对齐上游 opencode v1.18.20：network_error / network-error 变体（含
// finish_reason: network_error 形态的响应体）必须可重试，此前仅匹配带空格形态。
test("network error variants (underscore/hyphen/finish_reason) are retryable", () => {
  for (const message of [
    "provider stream aborted: network_error",
    "upstream responded with network-error",
    'response ended with "finish_reason": "network_error"',
  ]) {
    const error = { name: "UnknownError", data: { message } }
    expect(retryable(error, "opencode")).toBeDefined()
  }
})

test("RETRY_TOTAL_CAP_MS bounds silent retry windows to ~2 minutes", () => {
  expect(RETRY_TOTAL_CAP_MS).toBe(120_000)
  // 60s header timeout x 5 retries would otherwise stall the run loop ~6min
  expect(RETRY_TOTAL_CAP_MS).toBeLessThan(60_000 * 5)
})

test("generic unknown errors are not retryable", () => {
  const error = {
    name: "UnknownError",
    data: { message: "Some unrelated failure" },
  }
  expect(retryable(error, "opencode")).toBeUndefined()
})

test("free usage limit errors are fatal (fast fail, no retry spin)", () => {
  const error = new SessionV1.APIError({
    message: "429 rate limited",
    statusCode: 429,
    isRetryable: true,
    responseBody: JSON.stringify({ error: { type: "FreeUsageLimitError", message: "free quota exhausted" } }),
  })
  const result = retryable(error, "opencode")
  expect(result).toBeDefined()
  expect(result?.fatal).toBe(true)
  expect(result?.action?.reason).toBe("free_tier_limit")
})

test("account usage limit errors are fatal (fast fail, no retry spin)", () => {
  const error = new SessionV1.APIError({
    message: "429 rate limited",
    statusCode: 429,
    isRetryable: true,
    responseHeaders: { "retry-after": "46666" },
    responseBody: JSON.stringify({
      error: { type: "GoUsageLimitError", metadata: { limitName: "monthly" } },
    }),
  })
  const result = retryable(error, "opencode")
  expect(result).toBeDefined()
  expect(result?.fatal).toBe(true)
  expect(result?.action?.reason).toBe("account_rate_limit")
})

test("policy abandons fatal limit errors after a single status set", async () => {
  const sets: Array<{ attempt: number; message: string; next: number }> = []
  const error = new SessionV1.APIError({
    message: "429 rate limited",
    statusCode: 429,
    isRetryable: true,
    responseBody: JSON.stringify({ error: { type: "FreeUsageLimitError" } }),
  })
  const startedAt = Date.now()
  const result = await Effect.runPromise(
    Effect.fail(error).pipe(
      Effect.retry(
        policy({
          provider: "opencode",
          parse: (e) => e as never,
          set: (info) =>
            Effect.sync(() => {
              sets.push({ attempt: info.attempt, message: info.message, next: info.next })
            }),
        }),
      ),
      Effect.catch(() => Effect.succeed("failed" as const)),
    ),
  )
  // 快速失败三断言：零退避 set（action 由 actionFor 在错误呈现侧提供）、无等待、错误立即浮出
  expect(sets.length).toBe(0)
  expect(Date.now() - startedAt).toBeLessThan(2_000)
  expect(result).toBe("failed")
  // actionFor 提供升级提示（halt 侧呈现）
  const action = actionFor(error, "opencode")
  expect(action?.fatal).toBe(true)
  expect(action?.action?.reason).toBe("free_tier_limit")
})

test("policy still retries transient 5xx errors (non-fatal path intact)", async () => {
  const sets: Array<{ attempt: number; message: string; next: number }> = []
  let attempts = 0
  const flaky = () =>
    Effect.gen(function* () {
      attempts++
      if (attempts < 2) {
        return yield* Effect.fail(
          new SessionV1.APIError({ message: "503 service unavailable", statusCode: 503, isRetryable: true }),
        )
      }
      return "recovered"
    })
  const result = await Effect.runPromise(
    flaky().pipe(
      Effect.retry(
        policy({
          provider: "opencode",
          parse: (e) => e as never,
          set: (info) =>
            Effect.sync(() => {
              sets.push({ attempt: info.attempt, message: info.message, next: info.next })
            }),
        }),
      ),
      Effect.catch(() => Effect.succeed("failed" as const)),
    ),
  )
  // 一次 503 退避（2s）后恢复：set 恰好一次，非 fatal 路径未被破坏
  expect(sets.length).toBe(1)
  expect(result).toBe("recovered")
})
