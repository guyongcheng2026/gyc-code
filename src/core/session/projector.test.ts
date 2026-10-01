import { describe, expect, it } from "bun:test"
import { eq } from "drizzle-orm"
import { Effect } from "effect"
import { Database } from "../database/database"
import type { EventV2 } from "../event"
import { ProjectTable } from "../project/sql"
import { ProjectV2 } from "../project"
import { SessionSchema } from "./schema"
import { AbsolutePath } from "../schema"
import { SessionTable, TaskTable, CostLedgerTable } from "./sql"
import { applyUsage } from "./projector"
import * as TaskProjector from "./task-projector"

type Usage = {
  cost: number
  tokens: {
    input: number
    output: number
    reasoning: number
    cache: { read: number; write: number }
  }
  /** C-08：该 step 是压缩开销，不计入 task.cost */
  compaction?: boolean
}

const projectID = ProjectV2.ID.make("prj_test_data")
const sessionID = SessionSchema.ID.make("ses_usage_test")

const usage = (cost: number, input: number): Usage => ({
  cost,
  tokens: { input, output: 50, reasoning: 25, cache: { read: 10, write: 5 } },
})

const fakeEvents = (
  calls: Array<{ type: string; data: unknown }>,
  opts?: { failPublishLive?: boolean },
): EventV2.Interface =>
  ({
    publishLive: (definition: { type: string }, data: unknown) => {
      if (opts?.failPublishLive) return Effect.die("broadcast failed") as never
      calls.push({ type: definition.type, data })
      return Effect.succeed(undefined as never)
    },
  }) as unknown as EventV2.Interface

const seed = (now: number) =>
  Effect.gen(function* () {
    const { db } = yield* Database.Service
    yield* db
      .insert(ProjectTable)
      .values({ id: projectID, worktree: AbsolutePath.make("/tmp/project"), sandboxes: [], name: "test-project" })
      .run()
    yield* db
      .insert(SessionTable)
      .values({
        id: sessionID,
        project_id: projectID,
        slug: "usage-test",
        directory: "/tmp/project",
        title: "Usage test",
        version: "0.0.0-test",
        cost: 0,
        tokens_input: 0,
        tokens_output: 0,
        tokens_reasoning: 0,
        tokens_cache_read: 0,
        tokens_cache_write: 0,
        time_created: now,
        time_updated: now,
      })
      .run()
  })

const runInDb = <A, E>(effect: Effect.Effect<A, E, Database.Service>) =>
  Effect.runSync(Effect.provide(effect, Database.testLayer))

describe("session projector usage broadcast", () => {
  it("applies usage then publishes session.updated with fresh totals", () => {
    const published: Array<{ type: string; data: unknown }> = []
    const events = fakeEvents(published)
    const now = new Date().getTime()
    const totals = runInDb(
      Effect.gen(function* () {
        yield* seed(now)
        const { db } = yield* Database.Service
        yield* applyUsage(db, events, sessionID, usage(1.25, 100))
        const row = yield* db
          .select({ cost: SessionTable.cost, tokensInput: SessionTable.tokens_input })
          .from(SessionTable)
          .where(eq(SessionTable.id, sessionID))
          .get()
          .pipe(Effect.orDie)
        return row
      }),
    )!
    expect(totals.cost).toBeCloseTo(1.25)
    expect(totals.tokensInput).toBe(100)
    expect(published).toHaveLength(1)
    const first = published[0]
    if (first === undefined) throw new Error("fixture missing: published[0]")
    expect(first.type).toBe("session.updated")
    const info = (first.data as { info: { cost: number; tokens: { input: number } } }).info
    expect(info.cost).toBeCloseTo(1.25)
    expect(info.tokens.input).toBe(100)
  })

  it("publishes the accumulated totals after a second usage (append-only, no rollback)", () => {
    const published: Array<{ type: string; data: unknown }> = []
    const events = fakeEvents(published)
    const now = new Date().getTime()
    runInDb(
      Effect.gen(function* () {
        yield* seed(now)
        const { db } = yield* Database.Service
        yield* applyUsage(db, events, sessionID, usage(1.25, 100))
        yield* applyUsage(db, events, sessionID, usage(1.25, 100))
        const row = yield* db
          .select({ cost: SessionTable.cost, tokensInput: SessionTable.tokens_input })
          .from(SessionTable)
          .where(eq(SessionTable.id, sessionID))
          .get()
          .pipe(Effect.orDie)
        return row
      }),
    )
    expect(published).toHaveLength(2)
    const last = published[published.length - 1]
    if (last === undefined) throw new Error("fixture missing: last published event")
    const info = (last.data as { info: { cost: number; tokens: { input: number } } }).info
    expect(info.cost).toBeCloseTo(2.5)
    expect(info.tokens.input).toBe(200)
  })

  it("does not publish when the session row is missing", () => {
    const published: Array<{ type: string; data: unknown }> = []
    const events = fakeEvents(published)
    const fakeSessionID = SessionSchema.ID.make("ses_nonexistent")
    runInDb(
      Effect.gen(function* () {
        yield* seed(new Date().getTime())
        const { db } = yield* Database.Service
        yield* applyUsage(db, events, fakeSessionID, usage(1.25, 100))
      }),
    )
    expect(published).toHaveLength(0)
  })

  it("broadcast failure does not break the DB update", () => {
    const published: Array<{ type: string; data: unknown }> = []
    const events = fakeEvents(published, { failPublishLive: true })
    const now = new Date().getTime()
    const totals = runInDb(
      Effect.gen(function* () {
        yield* seed(now)
        const { db } = yield* Database.Service
        yield* applyUsage(db, events, sessionID, usage(2.5, 200))
        const row = yield* db
          .select({ cost: SessionTable.cost, tokensInput: SessionTable.tokens_input })
          .from(SessionTable)
          .where(eq(SessionTable.id, sessionID))
          .get()
          .pipe(Effect.orDie)
        return row
      }),
    )!
    expect(totals.cost).toBeCloseTo(2.5)
    expect(totals.tokensInput).toBe(200)
    expect(published).toHaveLength(0)
  })
})

/**
 * 2026-09-30（每任务成本 P0）验收：子代理跑在独立 session（tool/task.ts:165-181），
 * 此前其花费只落在子会话自己的 cost 列，父会话完全看不到 —— 父 spawn N 个子代理
 * 时「这个任务花了多少」是下限。修复后同一增量逐级上卷到所有祖先。
 */
describe("applyUsage 子代理成本上卷", () => {
  const rootID = SessionSchema.ID.make("ses_root")
  const childID = SessionSchema.ID.make("ses_child")
  const grandID = SessionSchema.ID.make("ses_grand")

  const seedTree = (now: number) =>
    Effect.gen(function* () {
      const { db } = yield* Database.Service
      yield* db
        .insert(ProjectTable)
        .values({ id: projectID, worktree: AbsolutePath.make("/tmp/project"), sandboxes: [], name: "p" })
        .run()
      const base = {
        project_id: projectID,
        directory: "/tmp/project",
        version: "0.0.0-test",
        cost: 0,
        tokens_input: 0,
        tokens_output: 0,
        tokens_reasoning: 0,
        tokens_cache_read: 0,
        tokens_cache_write: 0,
        time_created: now,
        time_updated: now,
      }
      yield* db
        .insert(SessionTable)
        .values({ ...base, id: rootID, slug: "root", title: "root" })
        .run()
      yield* db
        .insert(SessionTable)
        .values({ ...base, id: childID, slug: "child", title: "child", parent_id: rootID })
        .run()
      yield* db
        .insert(SessionTable)
        .values({ ...base, id: grandID, slug: "grand", title: "grand", parent_id: childID })
        .run()
    })

  // db 的类型直接取自 applyUsage 的首参，避免手写结构类型与实现漂移
  const costOf = (db: Parameters<typeof applyUsage>[0], id: SessionSchema.ID) =>
    db
      .select({ cost: SessionTable.cost, tokensInput: SessionTable.tokens_input })
      .from(SessionTable)
      .where(eq(SessionTable.id, id))
      .get()
      .pipe(Effect.orDie, Effect.map((r) => ({ cost: r?.cost ?? -1, tokensInput: r?.tokensInput ?? -1 })))

  it("子会话的用量同时计入父与祖父会话", () => {
    const events = fakeEvents([])
    const now = new Date().getTime()
    const got = runInDb(
      Effect.gen(function* () {
        yield* seedTree(now)
        const { db } = yield* Database.Service
        yield* applyUsage(db, events, grandID, usage(3, 300))
        return {
          grand: yield* costOf(db, grandID),
          child: yield* costOf(db, childID),
          root: yield* costOf(db, rootID),
        }
      }),
    )!
    expect(got.grand.cost).toBeCloseTo(3)
    expect(got.child.cost).toBeCloseTo(3)
    expect(got.root.cost).toBeCloseTo(3)
    expect(got.root.tokensInput).toBe(300)
  })

  it("三个子代理的花费全部体现在父会话上（合计 = 父子之和）", () => {
    const events = fakeEvents([])
    const now = new Date().getTime()
    const got = runInDb(
      Effect.gen(function* () {
        yield* seedTree(now)
        const { db } = yield* Database.Service
        yield* applyUsage(db, events, grandID, usage(1, 100))
        yield* applyUsage(db, events, grandID, usage(2, 200))
        yield* applyUsage(db, events, childID, usage(4, 400))
        return {
          root: yield* costOf(db, rootID),
          child: yield* costOf(db, childID),
          grand: yield* costOf(db, grandID),
        }
      }),
    )!
    // grand 自身 3；child 自身 4 + grand 上卷 3 = 7；root 收 grand 3 + child 4 = 7。
    // 整棵树的总花费就是 root.cost —— 这正是「一个任务花了多少」的答案。
    expect(got.grand.cost).toBeCloseTo(3)
    expect(got.child.cost).toBeCloseTo(7)
    expect(got.root.cost).toBeCloseTo(7)
    // 根必须不小于任一后代（后代已含自己的子树，不能再与孙层相加比较）
    expect(got.root.cost).toBeGreaterThanOrEqual(got.child.cost)
    expect(got.root.cost).toBeGreaterThanOrEqual(got.grand.cost)
  })

  it("append-only: second usage accumulates cost (no rollback on sign=-1)", () => {
    const events = fakeEvents([])
    const now = new Date().getTime()
    const got = runInDb(
      Effect.gen(function* () {
        yield* seedTree(now)
        const { db } = yield* Database.Service
        yield* applyUsage(db, events, grandID, usage(5, 500))
        yield* applyUsage(db, events, grandID, usage(5, 500))
        return { grand: yield* costOf(db, grandID), root: yield* costOf(db, rootID) }
      }),
    )!
    expect(got.grand.cost).toBeCloseTo(10)
    expect(got.root.cost).toBeCloseTo(10)
  })

  it("父链成环时不会死循环（深度/自引用闸门）", () => {
    const events = fakeEvents([])
    const now = new Date().getTime()
    const got = runInDb(
      Effect.gen(function* () {
        const { db } = yield* Database.Service
        yield* db
          .insert(ProjectTable)
          .values({ id: projectID, worktree: AbsolutePath.make("/tmp/p"), sandboxes: [], name: "p" })
          .run()
        const a = SessionSchema.ID.make("ses_cycle_a")
        const b = SessionSchema.ID.make("ses_cycle_b")
        const base = {
          project_id: projectID,
          directory: "/tmp/p",
          version: "0.0.0-test",
          cost: 0,
          tokens_input: 0,
          tokens_output: 0,
          tokens_reasoning: 0,
          tokens_cache_read: 0,
          tokens_cache_write: 0,
          time_created: now,
          time_updated: now,
        }
        // 先插 a（无父）再插 b 指向 a，随后把 a 指回 b 制造环
        yield* db.insert(SessionTable).values({ ...base, id: a, slug: "a", title: "a" }).run()
        yield* db.insert(SessionTable).values({ ...base, id: b, slug: "b", title: "b", parent_id: a }).run()
        yield* db.update(SessionTable).set({ parent_id: b }).where(eq(SessionTable.id, a)).run()
        yield* applyUsage(db, events, a, usage(1, 10))
        return { a: yield* costOf(db, a), b: yield* costOf(db, b) }
      }),
    )!
    // 每个会话至多被计一次：a 自己 +1，b 因已访问 a 而停止上卷
    expect(got.a.cost).toBeCloseTo(1)
    expect(got.b.cost).toBeCloseTo(1)
  })
})

/**
 * C-08：压缩开销的钱确实花了（要进 cost_ledger 与 session.cost），但它不是
 * 「本轮任务的产出」（不能进 task.cost）。两者混在一起时，调整压缩策略会让
 * 「一个 feature 花了多少」凭空跳变，且压缩越频繁看起来越贵。
 */
describe("C-08 压缩成本与任务成本分离", () => {
  const compactionUsage = (cost: number, input: number) => ({ ...usage(cost, input), compaction: true })

  it("压缩开销进 ledger 与 session.cost，但不进 task.cost", () => {
    const events = fakeEvents([])
    const now = new Date().getTime()
    const got = runInDb(
      Effect.gen(function* () {
        yield* seed(now)
        const { db } = yield* Database.Service

        // 先开一个 task（模拟用户发了一轮消息）
        yield* TaskProjector.openTask(db, sessionID, "msg_1" as never, "做一个功能")

        // 一次普通用量 + 一次压缩用量
        yield* applyUsage(db, events, sessionID, usage(1, 100))
        yield* applyUsage(db, events, sessionID, compactionUsage(0.4, 50))

        const session = yield* db
          .select({ cost: SessionTable.cost })
          .from(SessionTable)
          .where(eq(SessionTable.id, sessionID))
          .get()
          .pipe(Effect.orDie)
        const task = yield* db
          .select({ cost: TaskTable.cost })
          .from(TaskTable)
          .where(eq(TaskTable.session_id, sessionID))
          .get()
          .pipe(Effect.orDie)
        const ledger = yield* db
          .select({ eventType: CostLedgerTable.event_type, cost: CostLedgerTable.cost_usd })
          .from(CostLedgerTable)
          .where(eq(CostLedgerTable.session_id, sessionID))
          .all()
          .pipe(Effect.orDie)
        return { sessionCost: session?.cost ?? -1, taskCost: task?.cost ?? -1, ledger }
      }),
    )!
    // 钱确实花了：会话总额含压缩
    expect(got.sessionCost).toBeCloseTo(1.4)
    // 但不是任务产出：task 只算普通用量
    expect(got.taskCost).toBeCloseTo(1)
    // ledger 两笔都在，且压缩那笔可被 event_type 识别出来单列
    expect(got.ledger).toHaveLength(2)
    expect(got.ledger.find((r) => r.eventType === "compaction")?.cost).toBeCloseTo(0.4)
    expect(got.ledger.find((r) => r.eventType === "usage")?.cost).toBeCloseTo(1)
  })

  it("C-05：ledger 只增不改 —— 同一次用量重放不会抵消历史", () => {
    const events = fakeEvents([])
    const now = new Date().getTime()
    const ledgerCount = runInDb(
      Effect.gen(function* () {
        yield* seed(now)
        const { db } = yield* Database.Service
        yield* applyUsage(db, events, sessionID, usage(1, 100))
        yield* applyUsage(db, events, sessionID, usage(1, 100))
        return yield* db
          .select({ id: CostLedgerTable.id })
          .from(CostLedgerTable)
          .where(eq(CostLedgerTable.session_id, sessionID))
          .all()
          .pipe(Effect.orDie)
      }),
    )!
    // 两笔而不是「一增一减」——回退/重投影不该让历史成本被追溯改写
    expect(ledgerCount).toHaveLength(2)
  })
})
