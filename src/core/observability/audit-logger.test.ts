import { describe, expect, test } from "bun:test"
import { Effect, Logger } from "effect"
import { dispatchErrorAudit, setErrorAuditSink, type ErrorAuditRecord } from "./error-audit"
import { auditLogger, toAuditRecord } from "./logging"

describe("toAuditRecord 级别映射", () => {
  test("Error 级 → error 记录，message 附加字段提取 session.id", () => {
    // effect 4.0：Effect.logError("msg", { field }) 的第二参数进 message 数组。
    const record = toAuditRecord({
      logLevel: "Error",
      message: ["boom", { "session.id": "ses_abc" }],
      cause: undefined,
    })
    expect(record?.scope).toBe("effect.log")
    expect(record?.message).toBe("boom")
    expect(record?.level).toBe("error")
    expect(`${record?.sessionID}`).toBe("ses_abc")
    expect(record?.fields).toEqual({ "session.id": "ses_abc" })
  })

  test("Warning 级 → warn 记录", () => {
    const record = toAuditRecord({ logLevel: "Warning", message: "careful", cause: undefined })
    expect(record?.level).toBe("warn")
  })

  test("Info/Debug 级 → undefined（不落库，防递归）", () => {
    expect(toAuditRecord({ logLevel: "Info", message: "x", cause: undefined })).toBeUndefined()
    expect(toAuditRecord({ logLevel: "Debug", message: "x", cause: undefined })).toBeUndefined()
  })

  test("cause.reasons 非空时拼接进 message；message 数组首元素为文本", () => {
    const cause = { reasons: [{ _tag: "Fail" }] }
    const record = toAuditRecord({ logLevel: "Error", message: ["a"], cause })
    expect(record?.message.startsWith("a ::")).toBe(true)
    expect(record && record.message.length > 4).toBe(true)
  })

  test("空 Cause 不拼接；非对象附加字段被过滤", () => {
    const record = toAuditRecord({ logLevel: "Error", message: ["a", 42], cause: { reasons: [] } })
    expect(record?.message).toBe("a")
    expect(record?.fields).toEqual({})
  })
})

describe("auditLogger 接线（集成）", () => {
  test("Effect.logError 经 Logger 层进入 dispatchErrorAudit", async () => {
    const records: ErrorAuditRecord[] = []
    setErrorAuditSink((r) => records.push(r))
    try {
      await Effect.runPromise(
        Effect.logError("audit-int-test").pipe(
          Effect.provide(Logger.layer([auditLogger], { mergeWithExisting: false })),
        ),
      )
      // dispatchErrorAudit 走 queueMicrotask，让出一轮事件循环再断言。
      await new Promise((resolve) => setTimeout(resolve, 0))
      expect(records.some((r) => r.message.includes("audit-int-test"))).toBe(true)
    } finally {
      setErrorAuditSink(undefined)
    }
  })
})
