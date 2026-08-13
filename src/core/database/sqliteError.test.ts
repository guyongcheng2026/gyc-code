import { test, expect } from "bun:test"
import { Database, type SQLQueryBindings } from "bun:sqlite"
import { Effect, Cause } from "effect"
import { classifySqliteError, SqlError } from "effect/unstable/sql/SqlError"

// Mirrors `run()` in sqlite.bun.ts / sqlite.node.ts: the statement is prepared
// INSIDE the try so a prepare/execution error is classified as a typed SqlError
// instead of escaping as an unhandled defect (Effect.withFiber turns a sync
// throw outside the try into an opaque Die, losing the real error message).
const runSql = (db: Database, query: string, params: SQLQueryBindings[] = []) =>
  Effect.withFiber(() => {
    try {
      const statement = db.query(query)
      // @ts-ignore bun-types missing safeIntegers method
      statement.safeIntegers(false)
      return Effect.succeed((statement.all(...params) ?? []) as unknown[])
    } catch (cause) {
      return Effect.fail(
        new SqlError({
          reason: classifySqliteError(cause, { message: "Failed to execute statement", operation: "execute" }),
        }),
      )
    }
  })

test("invalid SQL yields a typed SqlError failure (not an unhandled Die)", async () => {
  const db = new Database(":memory:")
  const exit = await Effect.runPromise(Effect.exit(runSql(db, "SELECT * FROM missing_table_xyz")))
  expect(exit._tag).toBe("Failure")
  if (exit._tag === "Failure") {
    expect(Cause.squash(exit.cause)).toBeInstanceOf(SqlError)
  }
})

test("valid SQL executes successfully", async () => {
  const db = new Database(":memory:")
  db.run("CREATE TABLE t (id INTEGER)")
  db.run("INSERT INTO t VALUES (1)")
  const exit = await Effect.runPromise(Effect.exit(runSql(db, "SELECT * FROM t")))
  expect(exit._tag).toBe("Success")
})