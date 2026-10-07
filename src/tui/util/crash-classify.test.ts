import { describe, expect, it } from "bun:test"
import { isRecoverableRejection, shouldExitOnUnhandledRejection } from "./crash-classify"

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

describe("shouldExitOnUnhandledRejection", () => {
  // 回归锚点：worker 侧任何 unhandledRejection 都 exit(1)，而 worker 直接托管
  // HTTP server（src/cli/tui/worker.ts:186）。一次 SSE 超时就会掐断服务端，
  // TUI 的每个 HTTP 调用随之失败，表现为「发送提示词失败」
  // （src/tui/component/prompt/index.tsx:1192）。下面三类正是 gyccode.log 里
  // 实际出现过的文案，钉住它们以防上游措辞漂移后分级静默失效。
  it("keeps the worker alive on transient network failures", () => {
    expect(shouldExitOnUnhandledRejection(new TypeError("fetch failed"))).toBe(false)
    expect(shouldExitOnUnhandledRejection(new Error("socket hang up"))).toBe(false)
    expect(shouldExitOnUnhandledRejection(new Error("connect ECONNREFUSED 127.0.0.1:4300"))).toBe(false)
  })

  it("keeps the worker alive on provider stream errors and rate limits", () => {
    expect(shouldExitOnUnhandledRejection(new Error("ProviderResponseStreamError: SSE read timed out"))).toBe(false)
    expect(shouldExitOnUnhandledRejection(new Error("请求过于频繁，请稍后重试"))).toBe(false)
  })

  it("keeps the worker alive on user cancel", () => {
    expect(shouldExitOnUnhandledRejection(new DOMException("The operation was aborted", "AbortError"))).toBe(false)
  })

  it("still exits on genuine programming defects", () => {
    expect(shouldExitOnUnhandledRejection(new TypeError("Cannot read properties of undefined (reading 'x')"))).toBe(
      true,
    )
    expect(shouldExitOnUnhandledRejection(new ReferenceError("foo is not defined"))).toBe(true)
  })
})
