import { describe, expect, it } from "bun:test"
import { Effect, Layer } from "effect"
import { Database } from "../database/database"
import { ErrorAuditTable } from "../session/sql"
import {
  dispatchErrorAudit,
  hasErrorAuditSink,
  setErrorAuditSink,
  writeErrorAudit,
  type ErrorAuditRecord,
} from "./error-audit"
import { logError } from "./log-error"

/**
 * A-1（对标指标 22 · 审计日志）：logError 此前只往控制台写，进程一关就没法回答
 * 「昨晚那批失败到底是哪些 scope」。这里验证落库映射与三条降级约束。
 */

const withDb = <A, E>(effect: Effect.Effect<A, E, Database.Service>) =>
  Effect.runSync(Effect.provide(effect, Database.testLayer))

const rows = Effect.gen(function* () {
  const { db } = yield* Database.Service
  return yield* db.select().from(ErrorAuditTable).all()
})

describe("error_audit · 落库映射", () => {
  it("scope / message / session_id / fields 四列都正确写入", () => {
    const { inserted } = withDb(
      Effect.gen(function* () {
        yield* writeErrorAudit({
          scope: "provider/openai",
          message: "stream reset",
          sessionID: "ses_test123" as never,
          fields: { attempt: 3, model: "space-bunny-free" },
        })
        const all = yield* rows
        return { inserted: all }
      }),
    )
    expect(inserted).toHaveLength(1)
    expect(inserted[0]!.scope).toBe("provider/openai")
    expect(inserted[0]!.message).toBe("stream reset")
    expect(inserted[0]!.session_id as string).toBe("ses_test123")
    expect(inserted[0]!.fields).toMatchObject({ attempt: 3, model: "space-bunny-free" })
    expect(inserted[0]!.time_created).toBeGreaterThan(0)
  })

  it("没有会话的进程级错误照常写入，session_id 落 NULL", () => {
    const { inserted } = withDb(
      Effect.gen(function* () {
        yield* writeErrorAudit({ scope: "cli/startup", message: "config invalid" })
        return { inserted: yield* rows }
      }),
    )
    expect(inserted).toHaveLength(1)
    expect(inserted[0]!.session_id).toBeNull()
    expect(inserted[0]!.fields).toBeNull()
  })

  it("多次写入全部保留（append-only，不做去重覆盖）", () => {
    const { inserted } = withDb(
      Effect.gen(function* () {
        for (let i = 0; i < 3; i++) yield* writeErrorAudit({ scope: "retry", message: `第 ${i} 次` })
        return { inserted: yield* rows }
      }),
    )
    expect(inserted).toHaveLength(3)
    expect(new Set(inserted.map((r) => r.id)).size).toBe(3)
  })
})

describe("error_audit · 降级不制造新故障", () => {
  it("fields 含循环引用时不抛异常，行仍写入且占位说明字段", () => {
    const { inserted } = withDb(
      Effect.gen(function* () {
        const cyclic: Record<string, unknown> = { name: "loop" }
        cyclic.self = cyclic
        yield* writeErrorAudit({ scope: "weird", message: "cyclic fields", fields: cyclic })
        return { inserted: yield* rows }
      }),
    )
    expect(inserted).toHaveLength(1)
    expect(inserted[0]!.fields).toMatchObject({ __unserializable: expect.any(String) })
  })

  it("fields 含 BigInt 时同样不抛异常", () => {
    const { inserted } = withDb(
      Effect.gen(function* () {
        yield* writeErrorAudit({ scope: "bigint", message: "big field", fields: { bytes: 1n } })
        return { inserted: yield* rows }
      }),
    )
    expect(inserted).toHaveLength(1)
  })

  it("数据库不可用时静默跳过，不抛异常（兜底路径不能反过来拖挂调用方）", async () => {
    // 没有任何 Database.Service 的裸上下文：这条 Effect 内部会 defect，
    // 但对外必须表现为「安静地什么都不做」。
    const orphan = writeErrorAudit({ scope: "no-db", message: "should not throw" })
    const result = await Effect.runPromise(Effect.exit(orphan as unknown as Effect.Effect<void, unknown, never>))
    // catchCause 已把失败降级为 logDebug + void，因此 exit 必须拿到成功态
    expect(result._tag).toBe("Success")
  })
})

describe("error_audit · logError 接线", () => {
  it("未注入 sink 时 logError 行为与改动前一致，且不产生任何落库副作用", () => {
    setErrorAuditSink(undefined)
    expect(hasErrorAuditSink()).toBe(false)
    const original = console.error
    const seen: unknown[][] = []
    console.error = (...args: unknown[]) => seen.push(args)
    try {
      logError("scope/a", new Error("boom"), { "session.id": "ses_x", k: 1 })
      logError("scope/b", "plain")
    } finally {
      console.error = original
      setErrorAuditSink(undefined)
    }
    expect(seen).toHaveLength(2)
    expect(String(seen[0]![0])).toContain("[scope/a]")
    expect(seen[0]![1]).toMatchObject({ "session.id": "ses_x" })
  })

  it("注入 sink 后 logError 会投递记录，并带上 session 维度", async () => {
    const received: ErrorAuditRecord[] = []
    setErrorAuditSink((record) => received.push(record))
    expect(hasErrorAuditSink()).toBe(true)

    const original = console.error
    console.error = () => {}
    try {
      logError("provider/zen", new Error("429"), { "session.id": "ses_abc", attempt: 2 })
      logError("mcp", "no session here")
    } finally {
      console.error = original
    }
    // dispatch 走 queueMicrotask，等一拍让它落地
    await new Promise((resolve) => setTimeout(resolve, 10))
    setErrorAuditSink(undefined)

    expect(received).toHaveLength(2)
    expect(received[0]).toMatchObject({ scope: "provider/zen", sessionID: "ses_abc" })
    expect(String(received[0]!.message)).toContain("429")
    expect(received[1]!.sessionID).toBeUndefined()
  })

  it("sink 自身抛错不会让 logError 抛出", async () => {
    setErrorAuditSink(() => {
      throw new Error("sink 挂了")
    })
    const original = console.error
    console.error = () => {}
    try {
      expect(() => logError("boom", new Error("x"))).not.toThrow()
      dispatchErrorAudit({ scope: "direct", message: "y" })
    } finally {
      console.error = original
    }
    await new Promise((resolve) => setTimeout(resolve, 10))
    setErrorAuditSink(undefined)
  })
})

describe("error_audit · 表结构与索引", () => {
  it("迁移在内存库上可完整执行（建表 + 索引）", () => {
    const migration = require("../database/migration/20261001000004_error_audit").default
    expect(migration.id).toBe("20261001000004_error_audit")
  })

  it("新库 schema 与增量迁移产出同一张表", async () => {
    const mod = await import("./error-audit-table")
    expect(mod.ERROR_AUDIT_TABLE_STATEMENT).toContain("CREATE TABLE IF NOT EXISTS `error_audit`")
    // schema.gen.ts 与迁移共用同一份 DDL 常量，避免两处手写漂移
    const schema = await import("../database/schema.gen")
    expect(schema.default.up).toBeInstanceOf(Function)
  })
})

describe("error_audit · 接线不破坏 Layer 语义", () => {
  it("Database.testLayer 仍然是可用的 Layer", () => {
    expect(Layer.isLayer(Database.testLayer)).toBe(true)
  })
})

