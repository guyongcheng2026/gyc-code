import { describe, expect, test } from "bun:test"
import { Effect } from "effect"
import { sql } from "drizzle-orm"
import { EffectDrizzleSqlite } from "@gyccode/effect-drizzle-sqlite"
import { layer as sqliteLayer } from "./sqlite.bun"
import { pruneStaleEvents } from "./database"

type Db = Effect.Success<ReturnType<typeof EffectDrizzleSqlite.makeWithDefaults>>

const withDb = <A, E>(program: (db: Db) => Generator<Effect.Effect<unknown, E, never>, A, any>) =>
  Effect.gen(function* () {
    const db = yield* EffectDrizzleSqlite.makeWithDefaults()
    return yield* Effect.gen(function* () {
      return yield* program(db)
    })
  }).pipe(Effect.provide(sqliteLayer({ filename: ":memory:" })))

const DDL = [
  sql`CREATE TABLE session (id text primary key, time_updated integer not null)`,
  sql`CREATE TABLE event (id text primary key, aggregate_id text not null, seq integer not null, type text not null, data text not null)`,
  sql`CREATE TABLE event_sequence (aggregate_id text primary key, seq integer not null)`,
]

// 每个会话贡献 bytesPerSession 字节的 event，time_updated 递增（s0 最老）。
const seed = (db: Db, sessions: number, bytesPerSession: number) =>
  Effect.gen(function* () {
    const base = Date.now()
    for (const ddl of DDL) yield* db.run(ddl)
    for (let i = 0; i < sessions; i++) {
      const id = `ses_${i}`
      yield* db.run(sql`INSERT INTO session (id, time_updated) VALUES (${id}, ${base + i})`)
      yield* db.run(
        sql`INSERT INTO event (id, aggregate_id, seq, type, data) VALUES (${`ev_${i}`}, ${id}, ${1}, ${"message.part.updated.1"}, ${"x".repeat(bytesPerSession)})`,
      )
      yield* db.run(
        sql`INSERT INTO event_sequence (aggregate_id, seq) VALUES (${id}, ${1})`,
      )
    }
  })

describe("pruneStaleEvents 按大小上限裁剪", () => {
  test("未超上限时不删任何事件", async () => {
    const left = await Effect.runPromise(
      withDb(function* (db) {
        yield* seed(db, 3, 1000)
        yield* pruneStaleEvents(db, 10_000)
        const rows = yield* db.get<{ n: number }>(sql`SELECT COUNT(*) AS n FROM event`)
        return rows?.n ?? -1
      }),
    )
    expect(left).toBe(3)
  })

  test("超出上限时一次批量裁掉最老的会话，直到落回上限内", async () => {
    const after = await Effect.runPromise(
      withDb(function* (db) {
        yield* seed(db, 5, 1000)
        // 总量 5000、上限 2500：需删最老的 3 个（3000 ≥ 超额 2500），剩 2 个。
        yield* pruneStaleEvents(db, 2500)
        const total = yield* db.get<{ b: number }>(
          sql`SELECT SUM(LENGTH(data)) AS b FROM event`,
        )
        const ids = yield* db.all<{ id: string }>(sql`SELECT aggregate_id AS id FROM event ORDER BY id`)
        const seqs = yield* db.all<{ id: string }>(
          sql`SELECT aggregate_id AS id FROM event_sequence ORDER BY id`,
        )
        return { bytes: total?.b ?? -1, ids: ids.map((r) => r.id), seqs: seqs.map((r) => r.id) }
      }),
    )
    expect(after.bytes).toBeLessThanOrEqual(2500)
    // 保留的是最新的两个会话（最老的 ses_0/ses_1/ses_2 被裁掉）
    expect(after.ids).toEqual(["ses_3", "ses_4"])
    // 序列号必须与事件同步删除，不能留下孤立行
    expect(after.seqs).toEqual(["ses_3", "ses_4"])
  })

  test("会话数不足以覆盖超额时仍收敛，不死循环", async () => {
    const after = await Effect.runPromise(
      withDb(function* (db) {
        yield* seed(db, 2, 1000)
        // 上限 0：全部删空
        yield* pruneStaleEvents(db, 0)
        const rows = yield* db.get<{ n: number }>(sql`SELECT COUNT(*) AS n FROM event`)
        return rows?.n ?? -1
      }),
    )
    expect(after).toBe(0)
  })
})
