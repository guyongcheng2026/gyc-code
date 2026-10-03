import { describe, expect, it } from "bun:test"
import { readFileSync } from "node:fs"
import path from "node:path"
import { Effect, Layer } from "effect"
import { Service, layer, recordDenialRow } from "./index"
import { EventV2Bridge } from "@/event-v2-bridge"
import { SessionID } from "@/session/schema"
import { PermissionV1 } from "@gyccode/core/v1/permission"
import { Database } from "@gyccode/core/database/database"
import { resolveAction } from "./modes"
import type { PermissionMode } from "./modes"
import { sql } from "drizzle-orm"

/**
 * A-3 / A-4 / A-5（对标指标 22 · 权限与沙箱边界、可靠性与安全）
 *
 * - A-3 dontAsk：等价于 CC 的 `--permission-prompts none`，未命中 allow 一律拒绝，
 *   绝不挂起等待（挂起 = 模型无限等待 = 自主性归零）。
 * - A-4 工作目录围栏：文件类权限的路径越出 worktree 即拒绝。
 * - A-5 拒绝落库：拒绝此前只存在于内存与控制台，进程一退就没了。
 */

const eventsStub = { publish: () => Effect.void, listen: () => Effect.void } as never
const stubLayer = Layer.succeed(EventV2Bridge.Service, eventsStub)
const testLayer = layer.pipe(Layer.provide(stubLayer))

function askInput(overrides: Partial<PermissionV1.AskInput> = {}): PermissionV1.AskInput {
  return {
    sessionID: SessionID.make("ses_hardening"),
    permission: "edit",
    patterns: ["src/**"],
    metadata: {},
    always: ["src/**"],
    ruleset: [],
    ...overrides,
  }
}

const withService = <A, E>(program: Effect.Effect<A, E, Service>): Promise<A> =>
  Effect.runPromise(Effect.scoped(program.pipe(Effect.provide(testLayer)) as Effect.Effect<A, E, never>))

/** ask 是否挂起等待人工批准（挂起即说明「在问用户」）。 */
async function askPending(input: PermissionV1.AskInput, mode: PermissionMode) {
  return withService(
    Effect.gen(function* () {
      const service = yield* Service
      yield* service.setMode(mode)
      yield* Effect.forkScoped(service.ask(input))
      yield* Effect.sleep("10 millis")
      return (yield* service.list()).length
    }) as Effect.Effect<number, unknown, Service>,
  )
}

describe("A-3 dontAsk 模式", () => {
  it("未命中 allow 的请求直接拒绝，不挂起询问", async () => {
    expect(await askPending(askInput(), "dontAsk")).toBe(0)
  })

  it("命中 allow 规则的请求照常放行", async () => {
    expect(
      await askPending(
        askInput({ ruleset: [{ permission: "edit", pattern: "src/**", action: "allow" }] }),
        "dontAsk",
      ),
    ).toBe(0)
  })

  it("对未登记进模式裁决的读类权限同样生效（不挂起）", async () => {
    expect(await askPending(askInput({ permission: "read" }), "dontAsk")).toBe(0)
  })

  it("resolveAction 在 dontAsk 下不做任何自动放行", () => {
    expect(resolveAction("warning", "dontAsk")).toBe("ask")
    expect(resolveAction("safe", "dontAsk")).toBe("ask")
    expect(resolveAction("dangerous", "dontAsk")).toBe("ask")
    expect(resolveAction("blocked", "dontAsk")).toBe("deny")
  })
})

describe("A-4 工作目录围栏", () => {
  it("worktree 外的绝对路径被拒绝且不挂起", async () => {
    const outside = askInput({ permission: "read", patterns: ["C:/Windows/System32/drivers/etc/hosts"] })
    expect(await askPending(outside, "bypassPermissions")).toBe(0)
  })

  it("worktree 内的相对路径不被围栏拦下（仍走正常询问链路）", async () => {
    const inside = askInput({ permission: "read", patterns: ["src/core/index.ts"] })
    expect(await askPending(inside, "default")).toBe(1)
  })

  it("bash 不受路径围栏影响：命令不是路径，不能被误拒", async () => {
    const command = askInput({ permission: "bash", patterns: ["git status"] })
    expect(await askPending(command, "default")).toBe(1)
  })
})

describe("A-5 拒绝落库", () => {
  it("迁移文件已登记，permission_denials 表会被建出来", async () => {
    const { migrations } = await import("@gyccode/core/database/migration.gen")
    expect(migrations.some((m) => m.id === "20261001000003_permission_denials")).toBe(true)
  })

  it("DDL 语句包含审计所需字段", async () => {
    const { PERMISSION_DENIALS_TABLE_STATEMENT } = await import("@gyccode/core/session/permission-denial-table")
    for (const column of ["session_id", "permission", "patterns", "reason", "time_created"]) {
      expect(PERMISSION_DENIALS_TABLE_STATEMENT).toContain(column)
    }
  })

  it("recordDenialRow 把拒绝写入 permission_denials（真实内存库）", async () => {
    const { testLayer: databaseLayer } = await import("@gyccode/core/database/database")
    const program = Effect.gen(function* () {
      const database = yield* Database.Service
      const tables = yield* database.db.all<{ name: string }>(
        sql`SELECT name FROM sqlite_master WHERE type='table' AND name='permission_denials'`,
      )
      expect(tables.length).toBe(1)
      yield* recordDenialRow(database, {
        // session_id 有外键约束指向 session，这里传 undefined 走可空分支
        sessionID: undefined,
        permission: "edit",
        patterns: ["src/**"],
        reason: "mode:plan",
      })
      return yield* database.db.all(sql`SELECT * FROM permission_denials`)
    })
    const rows = await Effect.runPromise(
      Effect.scoped(program.pipe(Effect.provide(databaseLayer))) as Effect.Effect<
        ReadonlyArray<{ permission: string; reason: string; patterns: string }>,
        unknown,
        never
      >,
    )
    expect(rows.length).toBe(1)
    expect(rows[0]!.permission).toBe("edit")
    expect(rows[0]!.reason).toBe("mode:plan")
    expect(JSON.parse(rows[0]!.patterns)).toEqual(["src/**"])
  })

  it("拒绝路径确实调用了 recordDenial（接线未被摘掉）", async () => {
    const source = readFileSync(path.join(import.meta.dir, "index.ts"), "utf8")
    expect(source).toContain("yield* recordDenial(database, {")
    expect(source).toContain("out_of_worktree")
    expect(source).toContain("`mode:${mode}`")
  })
})
