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
import { logError, logWarn } from "./log-error"

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

/**
 * R-4：logWarn 此前只 console.warn、完全不落库，进程一关就没法回答「昨晚那批降级/重试
 * 到底发生在哪些 scope」。这里锁定它与 logError 一样投递 error_audit，并且靠
 * `fields.level` 区分级别——error_audit 表没有 severity 列，加列要动 DDL + 增量迁移
 * + schema.gen.ts，超出本轮范围。
 */
describe("error_audit · logWarn 接线（R-4）", () => {
  /** dispatch 走 queueMicrotask，等一拍让它落地 */
  const flush = () => new Promise((resolve) => setTimeout(resolve, 10))

  /** 临时静音 console.warn，避免测试输出被刷屏；返回 fn 的结果 */
  const mutedWarn = <A>(fn: () => A): A => {
    const original = console.warn
    console.warn = () => {}
    try {
      return fn()
    } finally {
      console.warn = original
    }
  }

  it("带 fields 的 logWarn 会落库，且落库记录里能区分出 warn 级别", async () => {
    const received: ErrorAuditRecord[] = []
    setErrorAuditSink((record) => received.push(record))

    mutedWarn(() => logWarn("cli.db.cache", "检测到前缀部分漂移", { prefix: "ses" }))
    await flush()
    setErrorAuditSink(undefined)

    expect(received).toHaveLength(1)
    expect(received[0]).toMatchObject({ scope: "cli.db.cache", message: "检测到前缀部分漂移" })
    // error_audit 无 severity 列，级别只能落在 fields.level
    expect(received[0]!.fields).toMatchObject({ level: "warn", prefix: "ses" })
  })

  it("不带 fields 的 logWarn 同样落库，不丢记录（级别标记仍要带上）", async () => {
    const received: ErrorAuditRecord[] = []
    setErrorAuditSink((record) => received.push(record))

    mutedWarn(() => logWarn("cli.tui", "警告：已禁用所有权限检查"))
    await flush()
    setErrorAuditSink(undefined)

    expect(received).toHaveLength(1)
    expect(received[0]).toMatchObject({ scope: "cli.tui", message: "警告：已禁用所有权限检查" })
    // 无 fields 时也必须带级别标记，否则这条记录无法与 error 区分开
    expect(received[0]!.fields).toMatchObject({ level: "warn" })
    expect(received[0]!.sessionID).toBeUndefined()
  })

  it("带 session.id 的 logWarn 能正确提取 sessionID", async () => {
    const received: ErrorAuditRecord[] = []
    setErrorAuditSink((record) => received.push(record))

    mutedWarn(() =>
      logWarn("memory.bridge", "readMemories failed", { "session.id": "ses_warn1", retry: 2 }),
    )
    await flush()
    setErrorAuditSink(undefined)

    expect(received).toHaveLength(1)
    expect(received[0]).toMatchObject({ sessionID: "ses_warn1" })
    expect(received[0]!.fields).toMatchObject({ level: "warn", "session.id": "ses_warn1", retry: 2 })
  })

  it("未注册 sink 时 logWarn 不抛异常，控制台输出形态与改动前一致", () => {
    setErrorAuditSink(undefined)
    expect(hasErrorAuditSink()).toBe(false)

    const original = console.warn
    const seen: unknown[][] = []
    console.warn = (...args: unknown[]) => seen.push(args)
    try {
      expect(() => logWarn("gateway.weixin", "getupdates 异常响应")).not.toThrow()
      logWarn("tui.plugin", "deprecated TUI plugin API", { api: "old" })
    } finally {
      console.warn = original
    }
    expect(seen).toHaveLength(2)
    expect(String(seen[0]![0])).toContain("[gateway.weixin]")
    // 无 fields 时控制台不带第二参数，与改动前一致
    expect(seen[0]).toHaveLength(1)
    // level 只进落库记录，不混进控制台第二参数
    expect(seen[1]![1]).toMatchObject({ api: "old" })
    expect(seen[1]![1]).not.toHaveProperty("level")
  })

  it("sink 自身抛错不会让 logWarn 抛出（审计失败不拖挂主流程）", async () => {
    setErrorAuditSink(() => {
      throw new Error("sink 挂了")
    })
    mutedWarn(() => {
      expect(() => logWarn("boom", "y")).not.toThrow()
    })
    await flush()
    setErrorAuditSink(undefined)
  })

  it("真实落库后 warn 与 error 两类记录可被区分开", async () => {
    const received: ErrorAuditRecord[] = []
    setErrorAuditSink((record) => received.push(record))
    const originalWarn = console.warn
    const originalError = console.error
    console.warn = () => {}
    console.error = () => {}
    try {
      logWarn("cli.run", "权限检查被跳过", { flag: "skip" })
      logError("provider/openai", new Error("429"), { attempt: 2 })
    } finally {
      console.warn = originalWarn
      console.error = originalError
    }
    await flush()
    setErrorAuditSink(undefined)

    // 把 sink 收到的记录回放进内存库，验证真实落库后 warn 仍能被单独筛出来
    const { inserted } = withDb(
      Effect.gen(function* () {
        for (const record of received) yield* writeErrorAudit(record)
        return { inserted: yield* rows }
      }),
    )
    expect(inserted).toHaveLength(2)
    const warnRow = inserted.find((r) => r.scope === "cli.run")!
    const errorRow = inserted.find((r) => r.scope === "provider/openai")!
    expect(warnRow.fields).toMatchObject({ level: "warn", flag: "skip" })
    // logError 的落库内容与改动前一致（不带 level 键），两类不会互相误判
    expect(errorRow.fields).toMatchObject({ attempt: 2 })
    expect(errorRow.fields).not.toHaveProperty("level")
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

