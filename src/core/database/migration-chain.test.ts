import { describe, expect, test } from "bun:test"
import { Effect } from "effect"
import { sql } from "drizzle-orm"
import { EffectDrizzleSqlite } from "@gyccode/effect-drizzle-sqlite"
import { layer as sqliteLayer } from "./sqlite.bun"
import { applyOnly } from "./migration"
import { migrations } from "./migration.gen"
import schema from "./schema.gen"

/**
 * 迁移链连通性（P0-1 回归）。
 *
 * 全库测试之所以全绿，是因为全新库走 `apply()` 的 schema.up 分支：它一次性建出
 * 最终表结构，并把**所有**迁移 id 直接写进 journal，一条迁移都不会真正执行。
 * 于是只有存量库才会踩的「表已含新列、迁移又去 ADD COLUMN」被完全掩盖。
 *
 * 这里造出真正的存量库形态：完整表结构 + journal 里缺最新几条迁移记录，
 * 再跑 applyOnly，断言整条链连通，且 002 不会因 start_cost 已存在而报
 * duplicate column name（migration.ts 没有 try/catch，原本会直接冒泡中断整链）。
 */

type Db = Effect.Success<ReturnType<typeof EffectDrizzleSqlite.makeWithDefaults>>

const NEW_MIGRATION_IDS = [
  "20261001000000_task",
  "20261001000001_cost_ledger",
  "20261001000002_task_start_cost",
  "20261001000003_permission_denials",
  "20261001000004_error_audit",
]

const withDb = <A, E>(program: (db: Db) => Generator<Effect.Effect<unknown, E, never>, A, any>) =>
  Effect.gen(function* () {
    const db = yield* EffectDrizzleSqlite.makeWithDefaults()
    return yield* Effect.gen(function* () {
      return yield* program(db)
    })
  }).pipe(Effect.provide(sqliteLayer({ filename: ":memory:" })))

/** 造一个「完整表结构 + journal 缺最新 N 条迁移」的存量库。 */
const legacyDb = (db: Db) =>
  Effect.gen(function* () {
    yield* db.transaction((tx) =>
      Effect.gen(function* () {
        yield* schema.up(tx)
        yield* tx.run(
          sql`CREATE TABLE ${sql.identifier("migration")} (id TEXT PRIMARY KEY, time_completed INTEGER NOT NULL)`,
        )
        // 只登记「旧迁移」，最新一批留空 —— 这正是升级后未跑到的状态
        yield* Effect.forEach(
          migrations.filter((migration) => !NEW_MIGRATION_IDS.includes(migration.id)),
          (migration) =>
            tx.run(
              sql`INSERT INTO ${sql.identifier("migration")} (id, time_completed) VALUES (${migration.id}, ${Date.now()})`,
            ),
        )
      }),
    )
  })

const journalIds = (db: Db) =>
  Effect.gen(function* () {
    const rows = yield* db.all<{ id: string }>(sql`SELECT id FROM migration`)
    return rows.map((row) => row.id)
  })

const columnsOf = (db: Db, table: string) =>
  Effect.gen(function* () {
    const rows = yield* db.all<{ name: string }>(sql.raw(`PRAGMA table_info(\`${table}\`)`))
    return rows.map((row) => row.name)
  })

describe("迁移链连通性（存量库走 applyOnly）", () => {
  test("journal 缺最新迁移时，整条链能连通跑完", async () => {
    const out = await Effect.runPromise(
      withDb(function* (db) {
        yield* legacyDb(db)
        yield* applyOnly(db, migrations)
        return { ids: yield* journalIds(db), taskColumns: yield* columnsOf(db, "task") }
      }),
    )
    for (const id of NEW_MIGRATION_IDS) expect(out.ids).toContain(id)
    expect(out.taskColumns).toContain("start_cost")
  })

  test("task 表已含 start_cost 时，补列迁移不抛 duplicate column name", async () => {
    const columns = await Effect.runPromise(
      withDb(function* (db) {
        yield* legacyDb(db)
        yield* db.run(sql`DELETE FROM migration WHERE id = '20261001000002_task_start_cost'`)
        yield* applyOnly(db, migrations)
        return yield* columnsOf(db, "task")
      }),
    )
    expect(columns).toContain("start_cost")
  })

  test("task 表尚无 start_cost 的更老库，补列迁移同样跑通", async () => {
    const columns = await Effect.runPromise(
      withDb(function* (db) {
        yield* legacyDb(db)
        yield* db.run(sql.raw("ALTER TABLE `task` DROP COLUMN `start_cost`"))
        yield* db.run(sql`DELETE FROM migration WHERE id = '20261001000002_task_start_cost'`)
        yield* applyOnly(db, migrations)
        return yield* columnsOf(db, "task")
      }),
    )
    expect(columns).toContain("start_cost")
  })

  test("整链已登记后重跑是幂等的（不再触发任何 ALTER）", async () => {
    const ids = await Effect.runPromise(
      withDb(function* (db) {
        yield* legacyDb(db)
        yield* applyOnly(db, migrations)
        yield* applyOnly(db, migrations)
        return yield* journalIds(db)
      }),
    )
    expect(new Set(ids).size).toBe(ids.length)
    for (const id of NEW_MIGRATION_IDS) expect(ids).toContain(id)
  })
})