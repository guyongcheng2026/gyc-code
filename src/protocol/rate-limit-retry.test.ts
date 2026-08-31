import { describe, expect, test } from "bun:test"
import { wrapRateLimitRetry } from "./rate-limit-retry"

function jsonResponse(status: number, headers: Record<string, string> = {}): Response {
  return new Response(JSON.stringify({ ok: status < 400 }), { status, headers })
}

/** 可控 fetch：依次返回队列中的响应，同时记录请求次数。 */
function makeFetch(...responses: Response[]) {
  const calls: Request[] = []
  const fn = async (req: Request) => {
    calls.push(req)
    const next = responses.shift()
    if (!next) throw new Error("fetch called more times than responses provided")
    return next
  }
  return { calls, fn }
}

describe("wrapRateLimitRetry", () => {
  test("非 429 响应原样透传，不重试", async () => {
    const { calls, fn } = makeFetch(jsonResponse(200))
    const wrapped = wrapRateLimitRetry(fn)
    const res = await wrapped(new Request("http://x/api/health"))
    expect(res.status).toBe(200)
    expect(calls).toHaveLength(1)
  })

  test("GET 429 后按 retry-after 退避重试成功", async () => {
    const { calls, fn } = makeFetch(jsonResponse(429, { "retry-after": "0" }), jsonResponse(200))
    const wrapped = wrapRateLimitRetry(fn)
    const res = await wrapped(new Request("http://x/api/provider"))
    expect(res.status).toBe(200)
    expect(calls).toHaveLength(2)
  })

  test("POST 429 不重试，原样透传（避免非幂等请求重放副作用）", async () => {
    const { calls, fn } = makeFetch(jsonResponse(429))
    const wrapped = wrapRateLimitRetry(fn)
    const res = await wrapped(new Request("http://x/api/session", { method: "POST" }))
    expect(res.status).toBe(429)
    expect(calls).toHaveLength(1)
  })

  test("连续 429 重试后仍失败：返回首个 429 响应，重试次数受 MAX_RETRIES 限制", async () => {
    const { calls, fn } = makeFetch(jsonResponse(429, { "retry-after": "0" }), jsonResponse(429, { "retry-after": "0" }))
    const wrapped = wrapRateLimitRetry(fn)
    const res = await wrapped(new Request("http://x/api/provider"))
    expect(res.status).toBe(429)
    // 1 次原始 + 1 次重试（MAX_RETRIES=1），不超过 2 次
    expect(calls).toHaveLength(2)
  })

  // 默认退避为 5s（DEFAULT_RETRY_AFTER_MS），需放宽超时避免与 5s 真实等待竞态
  test("无 retry-after 头时使用默认退避", async () => {
    const { calls, fn } = makeFetch(jsonResponse(429), jsonResponse(200))
    const wrapped = wrapRateLimitRetry(fn)
    const res = await wrapped(new Request("http://x/api/provider"))
    expect(res.status).toBe(200)
    expect(calls).toHaveLength(2)
  }, 8000)
})