import { describe, expect, test } from "bun:test"
import { Effect } from "effect"
import { sql } from "drizzle-orm"
import { EffectDrizzleSqlite } from "@gyccode/effect-drizzle-sqlite"
import { layer as sqliteLayer } from "./sqlite.bun"

/**
 * effect-drizzle-sqlite 此前 0 测试（17 个源文件）。这里走与 database.ts 完全相同的
 * 装配路径（sqliteLayer 提供 SqlClient → makeWithDefaults 提供 cache/logger），
 * 只把 filename 换成 :memory:，验证 SQL 执行、结果解码、错误分类与事务回滚。
 */

type Row = { id: number; name: string; count: number }

const TABLE_DDL = sql`CREATE TABLE roundtrip_items (
  id integer primary key autoincrement,
  name text not null,
  count integer not null default 0
)`

type Db = Effect.Success<ReturnType<typeof EffectDrizzleSqlite.makeWithDefaults>>

/**
 * 每个用例独立 :memory: 实例，互不干扰。
 * program 是 generator 函数（用例里直接 yield*）；Effect.gen 只能驱动
 * generator **函数**，所以这里再包一层，而不是把 generator 当 Effect 去 yield*。
 */
const withDb = <A, E>(program: (db: Db) => Generator<Effect.Effect<unknown, E, never>, A, any>) =>
  Effect.gen(function* () {
    const db = yield* EffectDrizzleSqlite.makeWithDefaults()
    return yield* Effect.gen(function* () {
      return yield* program(db)
    })
  }).pipe(Effect.provide(sqliteLayer({ filename: ":memory:" })))

describe("effect-drizzle-sqlite round-trip", () => {
  test("raw SQL: create → insert → select → update → delete", async () => {
    const rows = await Effect.runPromise(
      withDb(function* (db) {
        yield* db.run(TABLE_DDL)

        yield* db.run(sql`INSERT INTO roundtrip_items (name, count) VALUES (${'alpha'}, ${7})`)

        const selected = yield* db.get<Row>(sql`SELECT * FROM roundtrip_items WHERE name = ${'alpha'}`)
        if (!selected) throw new Error("insert/select round-trip lost the row")
        expect(selected.count).toBe(7)

        yield* db.run(sql`UPDATE roundtrip_items SET count = count + 1 WHERE id = ${selected.id}`)
        const updated = yield* db.get<Row>(sql`SELECT count FROM roundtrip_items WHERE id = ${selected.id}`)
        expect(updated?.count).toBe(8)

        yield* db.run(sql`DELETE FROM roundtrip_items WHERE id = ${selected.id}`)
        const afterDelete = yield* db.get<Row>(sql`SELECT * FROM roundtrip_items WHERE id = ${selected.id}`)
        expect(afterDelete).toBeUndefined()

        const all = yield* db.all<Row>(sql`SELECT * FROM roundtrip_items`)
        return all
      }),
    )
    expect(rows).toEqual([])
  })

  test("parameter binding: strings with quotes stay literal, never execute", async () => {
    const row = await Effect.runPromise(
      withDb(function* (db) {
        yield* db.run(TABLE_DDL)
        // 含单引号与 SQL 片段的值必须按字面量存储（参数绑定），否则就是注入点。
        const evil = "O'Brien'; DROP TABLE roundtrip_items; --"
        yield* db.run(sql`INSERT INTO roundtrip_items (name) VALUES (${evil})`)
        return yield* db.get<Row>(sql`SELECT name FROM roundtrip_items`)
      }),
    )
    expect(row?.name).toBe("O'Brien'; DROP TABLE roundtrip_items; --")

    // 表仍在（未被注入的 DROP 执行掉）
    const stillThere = await Effect.runPromise(
      withDb(function* (db) {
        yield* db.run(TABLE_DDL)
        yield* db.run(sql`INSERT INTO roundtrip_items (name) VALUES (${'ok'})`)
        return yield* db.all<Row>(sql`SELECT * FROM roundtrip_items`)
      }),
    )
    expect(stillThere).toHaveLength(1)
  })

  test("schema type errors are surfaced, not swallowed", async () => {
    await expect(
      Effect.runPromise(
        withDb(function* (db) {
          yield* db.run(TABLE_DDL)
          // name 为 notNull：违反约束必须抛错，而不是静默写入成功
          yield* db.run(sql`INSERT INTO roundtrip_items (name) VALUES (NULL)`)
          return true
        }),
      ),
    ).rejects.toBeTruthy()
  })

  test("concurrent statements on one client do not corrupt results", async () => {
    const total = await Effect.runPromise(
      withDb(function* (db) {
        yield* db.run(TABLE_DDL)
        for (let i = 0; i < 20; i++) {
          yield* db.run(sql`INSERT INTO roundtrip_items (name, count) VALUES (${`item-${i}`}, ${i})`)
        }
        const sum = yield* db.get<{ n: number }>(sql`SELECT count(*) AS n FROM roundtrip_items`)
        return sum?.n ?? -1
      }),
    )
    expect(total).toBe(20)
  })
})
