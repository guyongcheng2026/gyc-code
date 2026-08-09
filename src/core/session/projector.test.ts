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
    )
    expect(totals.cost).toBeCloseTo(1.25)
    expect(totals.tokensInput).toBe(100)
    expect(published).toHaveLength(1)
    expect(published[0].type).toBe("session.updated")
    const info = (published[0].data as { info: { cost: number; tokens: { input: number } } }).info
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
    )
    expect(totals.cost).toBeCloseTo(2.5)
    expect(totals.tokensInput).toBe(200)
    expect(published).toHaveLength(0)
  })
})
