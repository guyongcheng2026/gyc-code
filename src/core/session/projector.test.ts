import { describe, expect, it } from "bun:test"
import { eq } from "drizzle-orm"
import { Effect } from "effect"
import { Database } from "../database/database"
import type { EventV2 } from "../event"
import { ProjectTable } from "../project/sql"
import { ProjectV2 } from "../project"
import { SessionSchema } from "./schema"
import { AbsolutePath } from "../schema"
import { SessionTable } from "./sql"
import { applyUsage } from "./projector"

type Usage = {
  cost: number
  tokens: {
    input: number
    output: number
    reasoning: number
    cache: { read: number; write: number }
  }
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
  Effect.runSync(Effect.provide(effect, Database.layerFromPath(":memory:")))

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

  it("publishes the reduced totals after a reverse delta", () => {
    const published: Array<{ type: string; data: unknown }> = []
    const events = fakeEvents(published)
    const now = new Date().getTime()
    runInDb(
      Effect.gen(function* () {
        yield* seed(now)
        const { db } = yield* Database.Service
        yield* applyUsage(db, events, sessionID, usage(1.25, 100))
        yield* applyUsage(db, events, sessionID, usage(1.25, 100), -1)
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
    expect(info.cost).toBeCloseTo(0)
    expect(info.tokens.input).toBe(0)
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

  it("回退（sign=-1）同样上卷，父子两侧不产生永久性偏差", () => {
    const events = fakeEvents([])
    const now = new Date().getTime()
    const got = runInDb(
      Effect.gen(function* () {
        yield* seedTree(now)
        const { db } = yield* Database.Service
        yield* applyUsage(db, events, grandID, usage(5, 500))
        yield* applyUsage(db, events, grandID, usage(5, 500), -1)
        return { grand: yield* costOf(db, grandID), root: yield* costOf(db, rootID) }
      }),
    )!
    expect(got.grand.cost).toBeCloseTo(0)
    expect(got.root.cost).toBeCloseTo(0)
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
