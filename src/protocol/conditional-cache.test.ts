import { describe, expect, test } from "bun:test"

import { wrapConditionalGet } from "./conditional-cache"

/**
 * conditional-cache 并发与单飞行语义
 *
 * inFlight 去重：同一 URL 的并发请求共享同一个飞行中的 promise，
 * Response.body 是独占流，直接共享同一 Response 会让第二个 awaiter
 * 读 body 时报 "Body already read"。因此每次 resolve 时 clone（tee 分支
 * 互不干扰），两个消费方拿到的 body 均未消耗，clone 安全。
 * 断言两条护栏：
 * 1. 同一 URL 只有一次后端去重被 fetch；
 * 2. 每个消费方都能独立读取 body。
 */

const PROVIDER_URL = "https://x.test/api/provider"

function providerResponse(body: string, etag?: string): Response {
  const headers = new Headers({ "content-type": "application/json" })
  if (etag) headers.set("etag", etag)
  return new Response(body, { status: 200, headers })
}

describe("conditional-cache 并发去重与单飞行", () => {
  test("同一 URL，fetchImpl 只调一次，且每个消费方都能读 body", async () => {
    let calls = 0
    const wrapped = wrapConditionalGet(async () => {
      calls++
      await new Promise((resolve) => setTimeout(resolve, 10))
      return providerResponse(JSON.stringify({ a: 1 }), `"v1"`)
    })

    const [r1, r2] = await Promise.all([wrapped(new Request(PROVIDER_URL)), wrapped(new Request(PROVIDER_URL))])

    expect(calls).toBe(1)
    expect(((await r1.json()) as { a: number }).a).toBe(1)
    expect(((await r2.json()) as { a: number }).a).toBe(1)
    expect(r1.headers.get("x-gyccode-cache")).toBeNull()
  })

  test("MAX_AGE 内的第二次请求直接回放缓存（本地命中）", async () => {
    let calls = 0
    const wrapped = wrapConditionalGet(async () => {
      calls++
      return providerResponse(JSON.stringify({ b: 2 }), `"v1"`)
    })

    await wrapped(new Request(PROVIDER_URL))
    const second = await wrapped(new Request(PROVIDER_URL))

    expect(calls).toBe(1)
    expect(second.headers.get("x-gyccode-cache")).toBe("local")
    expect(second.headers.get("etag")).toBe(`"v1"`)
    expect(((await second.json()) as { b: number }).b).toBe(2)
  })

  test("MAX_AGE 内二次请求命中本地缓存，两个消费方 body 均可读", async () => {
    let calls = 0
    const wrapped = wrapConditionalGet(async (req) => {
      calls++
      if (req.headers.get("if-none-match")) return new Response(null, { status: 304, headers: new Headers({ etag: `"v1"` }) })
      return providerResponse(JSON.stringify({ c: 3 }), `"v1"`)
    })

    await wrapped(new Request(PROVIDER_URL))
    const [r2, r3] = await Promise.all([wrapped(new Request(PROVIDER_URL)), wrapped(new Request(PROVIDER_URL))])

    expect(calls).toBe(1)
    expect(r2.headers.get("x-gyccode-cache")).toBe("local")
    expect(r3.headers.get("x-gyccode-cache")).toBe("local")
    expect(r2.status).toBe(200)
    expect(r3.status).toBe(200)
    expect(((await r2.json()) as { c: number }).c).toBe(3)
    expect(((await r3.json()) as { c: number }).c).toBe(3)
  })

  test("无 etag 响应也走并发去重，两个消费方可读 body", async () => {
    let calls = 0
    const wrapped = wrapConditionalGet(async () => {
      calls++
      await new Promise((resolve) => setTimeout(resolve, 5))
      return providerResponse(JSON.stringify({ d: 4 }))
    })

    const [r1, r2] = await Promise.all([wrapped(new Request(PROVIDER_URL)), wrapped(new Request(PROVIDER_URL))])

    expect(calls).toBe(1)
    expect(((await r1.json()) as { d: number }).d).toBe(4)
    expect(((await r2.json()) as { d: number }).d).toBe(4)
  })
})