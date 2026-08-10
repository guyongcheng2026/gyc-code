import { describe, expect, it } from "bun:test"
import { Effect } from "effect"
import { Database } from "../database/database"
import { ProjectTable } from "../project/sql"
import { ProjectV2 } from "../project"
import { SessionSchema } from "./schema"
import { SessionMessageTable, SessionTable } from "./sql"
import { dedupeByContent } from "./dedupe"
import { AbsolutePath } from "../schema"
import * as SessionMessage from "./message"

const projectA = ProjectV2.ID.make("prj_dedupe_a")
const projectB = ProjectV2.ID.make("prj_dedupe_b")

type SessionLike = { id: SessionSchema.ID; projectID: ProjectV2.ID; timeUpdated: number }

const sid = (n: number) => SessionSchema.ID.make(`ses_dedupe_${n}`)

const runInDb = <A, E>(effect: Effect.Effect<A, E, Database.Service>) =>
  Effect.runSync(Effect.provide(effect, Database.layerFromPath(":memory:")))

const seedProject = (id: ProjectV2.ID) =>
  Effect.gen(function* () {
    const { db } = yield* Database.Service
    yield* db
      .insert(ProjectTable)
      .values({ id, worktree: AbsolutePath.make(`/tmp/${id}`), sandboxes: [], name: `project-${id}` })
      .run()
  })

const seedSession = (id: SessionSchema.ID, projectID: ProjectV2.ID, updated: number) =>
  Effect.gen(function* () {
    const { db } = yield* Database.Service
    yield* db
      .insert(SessionTable)
      .values({
        id,
        project_id: projectID,
        slug: id,
        directory: "/tmp/dedupe",
        title: "dedupe test",
        version: "0.0.0-test",
        cost: 0,
        tokens_input: 0,
        tokens_output: 0,
        tokens_reasoning: 0,
        tokens_cache_read: 0,
        tokens_cache_write: 0,
        time_created: updated,
        time_updated: updated,
      })
      .run()
  })

const seedMessages = (id: SessionSchema.ID, msgs: Array<{ type: string; seq: number; data: unknown }>) =>
  Effect.gen(function* () {
    const { db } = yield* Database.Service
    for (const [i, m] of msgs.entries()) {
      yield* db
        .insert(SessionMessageTable)
        .values({
          id: SessionMessage.ID.create(),
          session_id: id,
          type: m.type as SessionMessage.Type,
          seq: m.seq,
          time_created: 1_000 + i,
          time_updated: 1_000 + i,
          data: m.data as never,
        })
        .run()
    }
  })

const dedupe = (sessions: SessionLike[]) =>
  Effect.gen(function* () {
    const { db } = yield* Database.Service
    return yield* dedupeByContent(db, sessions, (s) => s.timeUpdated)
  })

const msgs = [
  { type: "user", seq: 0, data: { prompt: "hi" } },
  { type: "assistant", seq: 1, data: { text: "hello" } },
]

describe("dedupeByContent", () => {
  it("同项目内容相同只保留最新一条", () => {
    const sessions = [
      { id: sid(1), projectID: projectA, timeUpdated: 100 },
      { id: sid(2), projectID: projectA, timeUpdated: 200 },
    ]
    const result = runInDb(
      Effect.gen(function* () {
        yield* seedProject(projectA)
        yield* seedSession(sid(1), projectA, 100)
        yield* seedSession(sid(2), projectA, 200)
        yield* seedMessages(sid(1), msgs)
        yield* seedMessages(sid(2), msgs)
        return yield* dedupe(sessions)
      }),
    )!
    expect(result).toHaveLength(1)
    expect(result[0].id).toBe(sid(2))
  })

  it("不同项目内容相同不去重", () => {
    const sessions = [
      { id: sid(1), projectID: projectA, timeUpdated: 100 },
      { id: sid(2), projectID: projectB, timeUpdated: 200 },
    ]
    const result = runInDb(
      Effect.gen(function* () {
        yield* seedProject(projectA)
        yield* seedProject(projectB)
        yield* seedSession(sid(1), projectA, 100)
        yield* seedSession(sid(2), projectB, 200)
        yield* seedMessages(sid(1), msgs)
        yield* seedMessages(sid(2), msgs)
        return yield* dedupe(sessions)
      }),
    )!
    expect(result).toHaveLength(2)
  })

  it("同项目内容不同不去重", () => {
    const sessions = [
      { id: sid(1), projectID: projectA, timeUpdated: 100 },
      { id: sid(2), projectID: projectA, timeUpdated: 200 },
    ]
    const other = [{ type: "user", seq: 0, data: { prompt: "different" } }]
    const result = runInDb(
      Effect.gen(function* () {
        yield* seedProject(projectA)
        yield* seedSession(sid(1), projectA, 100)
        yield* seedSession(sid(2), projectA, 200)
        yield* seedMessages(sid(1), msgs)
        yield* seedMessages(sid(2), other)
        return yield* dedupe(sessions)
      }),
    )!
    expect(result).toHaveLength(2)
  })

  it("消息 seq 乱序插入时指纹仍按 seq 升序一致", () => {
    const sessions = [
      { id: sid(1), projectID: projectA, timeUpdated: 100 },
      { id: sid(2), projectID: projectA, timeUpdated: 200 },
    ]
    const reversed = [...msgs].reverse()
    const result = runInDb(
      Effect.gen(function* () {
        yield* seedProject(projectA)
        yield* seedSession(sid(1), projectA, 100)
        yield* seedSession(sid(2), projectA, 200)
        yield* seedMessages(sid(1), msgs)
        yield* seedMessages(sid(2), reversed)
        return yield* dedupe(sessions)
      }),
    )!
    expect(result).toHaveLength(1)
    expect(result[0].id).toBe(sid(2))
  })

  it("去重后保持原列表顺序", () => {
    const sessions = [
      { id: sid(1), projectID: projectA, timeUpdated: 300 },
      { id: sid(2), projectID: projectA, timeUpdated: 200 },
      { id: sid(3), projectID: projectA, timeUpdated: 100 },
    ]
    const other = [{ type: "user", seq: 0, data: { prompt: "other" } }]
    const result = runInDb(
      Effect.gen(function* () {
        yield* seedProject(projectA)
        yield* seedSession(sid(1), projectA, 300)
        yield* seedSession(sid(2), projectA, 200)
        yield* seedSession(sid(3), projectA, 100)
        yield* seedMessages(sid(1), other)
        yield* seedMessages(sid(2), msgs)
        yield* seedMessages(sid(3), msgs)
        return yield* dedupe(sessions)
      }),
    )!
    expect(result.map((s) => s.id)).toEqual([sid(1), sid(2)])
  })

  it("空列表与单条直接返回", () => {
    const empty = runInDb(dedupe([]))!
    expect(empty).toHaveLength(0)
    const single = runInDb(dedupe([{ id: sid(1), projectID: projectA, timeUpdated: 100 }]))!
    expect(single).toHaveLength(1)
    expect(single[0].id).toBe(sid(1))
  })
})