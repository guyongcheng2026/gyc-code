import type { Argv } from "yargs"
import { spawn } from "child_process"
import { Database } from "@gyccode/core/database/database"
import { Effect } from "effect"
import { sql } from "drizzle-orm"
import { effectCmd } from "../effect-cmd"

const QueryCommand = effectCmd({
  command: "query [query]",
  describe: "run a SQL query or open an interactive sqlite3 shell",
  instance: false,
  builder: (yargs: Argv) => {
    return yargs
      .positional("query", {
        type: "string",
        describe: "SQL query to execute",
      })
      .option("format", {
        type: "string",
        choices: ["json", "tsv"],
        default: "tsv",
        describe: "Output format",
      })
  },
  handler: Effect.fn("Cli.db.query")(function* (args: { query?: string; format: string }) {
    const query = args.query as string | undefined
    if (query) {
      const { db } = yield* Database.Service
      const result = yield* db.all<Record<string, unknown>>(sql.raw(query)).pipe(Effect.orDie)
      if (args.format === "json") console.log(JSON.stringify(result, null, 2))
      else if (result.length > 0) {
        const keys = Object.keys(result[0])
        console.log(keys.join("\t"))
        for (const row of result) console.log(keys.map((key) => row[key]).join("\t"))
      }
      return
    }
    const child = spawn("sqlite3", [Database.path()], {
      stdio: "inherit",
    })
    yield* Effect.promise(() => new Promise((resolve) => child.on("close", resolve)))
  }),
})

const PathCommand = effectCmd({
  command: "path",
  describe: "print the database path",
  instance: false,
  handler: Effect.fn("Cli.db.path")(function* () {
    console.log(Database.path())
  }),
})

const CleanupCommand = effectCmd({
  command: "cleanup",
  describe: "delete orphaned durable events (sessions that no longer exist) and VACUUM",
  instance: false,
  handler: Effect.fn("Cli.db.cleanup")(function* () {
    const { db } = yield* Database.Service
    // Orphaned events: event aggregates (session ids) with no matching session row.
    yield* db.run(sql.raw(`DELETE FROM event WHERE aggregate_id NOT IN (SELECT id FROM session)`)).pipe(Effect.orDie)
    yield* db.run(sql.raw(`DELETE FROM event_sequence WHERE aggregate_id NOT IN (SELECT id FROM session)`)).pipe(
      Effect.orDie,
    )
    yield* db.run(sql.raw(`VACUUM`)).pipe(Effect.orDie)
    // VACUUM in WAL mode grows the -wal file; checkpoint it back into the main db.
    yield* db.run(sql.raw(`PRAGMA wal_checkpoint(TRUNCATE)`)).pipe(Effect.orDie)
    console.log("deleted orphaned events; vacuumed")
  }),
})
const CacheCommand = effectCmd({
  command: "cache",
  describe: "report recent prompt-cache hit rate from persisted message tokens",
  instance: false,
  handler: Effect.fn("Cli.db.cache")(function* () {
    const { db } = yield* Database.Service
    const rows = yield* db
      .all<{ data: string }>(sql.raw(`SELECT data FROM message ORDER BY time_created DESC LIMIT 50`))
      .pipe(Effect.orDie)
    let input = 0
    let cacheRead = 0
    let withTokens = 0
    for (const row of rows) {
      try {
        const data = JSON.parse(row.data)
        const t = data.tokens
        if (!t) continue
        // total = full input tokens (incl. cached); cache.read = served from cache
        const totalInput = typeof t.total === "number" ? t.total : (typeof t.input === "number" ? t.input : 0)
        if (totalInput <= 0) continue
        withTokens++
        input += totalInput
        cacheRead += t.cache?.read ?? 0
      } catch {
        // skip malformed rows
      }
    }
    if (withTokens === 0) {
      console.log("no token usage persisted in the last 50 messages")
      return
    }
    const rate = input > 0 ? ((cacheRead / input) * 100).toFixed(1) : "0.0"
    console.log(`messages with usage: ${withTokens}`)
    console.log(`non-cached input tokens: ${input}`)
    console.log(`cache-read tokens: ${cacheRead}`)
    console.log(`prompt-cache hit rate: ${rate}%`)
    if (rate === "0.0" && input > 0) {
      console.log("note: 0% suggests the current model/provider does not report prompt caching,")
      console.log("or the system-prompt prefix changes between requests.")
    }
  }),
})
export const DbCommand = effectCmd({
  command: "db",
  describe: "database tools",
  instance: false,
  builder: (yargs: Argv) => {
    return yargs.command(QueryCommand).command(PathCommand).command(CleanupCommand).command(CacheCommand).demandCommand()
  },
  handler: Effect.fn("Cli.db")(function* () {}),
})
