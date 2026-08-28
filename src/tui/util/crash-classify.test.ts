import { describe, expect, it } from "bun:test"
import { isRecoverableRejection } from "./crash-classify"

describe("isRecoverableRejection", () => {
  it("treats AbortError / Aborted (user cancel) as recoverable", () => {
    expect(isRecoverableRejection(new DOMException("The operation was aborted", "AbortError"))).toBe(true)
    expect(isRecoverableRejection(new Error("Aborted"))).toBe(true)
    expect(isRecoverableRejection(new Error("AbortError: The user aborted a request"))).toBe(true)
  })

  it("treats rate-limited (429) errors as recoverable", () => {
    // 服务端限流中间件（rate-limit.ts）抛出的 TooManyRequestsError 文案
    expect(isRecoverableRejection(new Error("请求过于频繁，请稍后重试"))).toBe(true)
    expect(isRecoverableRejection(new Error("TooManyRequestsError: 请求过于频繁，请稍后重试"))).toBe(true)
    expect(isRecoverableRejection(new Error("rate limit exceeded"))).toBe(true)
  })

  it("treats SSE read timeout as recoverable", () => {
    expect(isRecoverableRejection(new Error("SSE read timed out"))).toBe(true)
    expect(isRecoverableRejection(new Error("ProviderResponseStreamError: SSE read timed out"))).toBe(true)
  })

  it("treats atomic-write EPERM (model.json rename race) as recoverable", () => {
    expect(
      isRecoverableRejection(
        new Error(
          "EPERM: operation not permitted, rename 'C:\\Users\\x\\.local\\state\\gyccode\\model.json.7780.tmp' -> 'C:\\Users\\x\\.local\\state\\gyccode\\model.json'",
        ),
      ),
    ).toBe(true)
  })

  it("treats transient network failures as recoverable", () => {
    expect(isRecoverableRejection(new TypeError("fetch failed"))).toBe(true)
    expect(isRecoverableRejection(new TypeError("Network request failed"))).toBe(true)
    expect(isRecoverableRejection(new Error("connect ECONNREFUSED 127.0.0.1:4300"))).toBe(true)
    expect(isRecoverableRejection(new Error("socket hang up"))).toBe(true)
  })

  it("treats ordinary programming errors as fatal", () => {
    expect(isRecoverableRejection(new TypeError("Cannot read properties of undefined (reading 'x')"))).toBe(false)
    expect(isRecoverableRejection(new ReferenceError("foo is not defined"))).toBe(false)
    expect(isRecoverableRejection(new Error("Unexpected token '}'"))).toBe(false)
  })

  it("treats non-Error values conservatively as fatal", () => {
    expect(isRecoverableRejection("plain string")).toBe(false)
    expect(isRecoverableRejection(undefined)).toBe(false)
  })
})
