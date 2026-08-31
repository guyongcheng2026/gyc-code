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
// 与 compaction.ts 的 TOOL_OUTPUT_MAX_CHARS 对齐：存量 compacted part 的
// 超长工具输出截断保留的头部摘要长度。
const RETRO_COMPACT_CHARS = 2_000
const PART_BATCH = 500

const CompactCommand = effectCmd({
  command: "compact",
  describe: "compact long tool outputs of already-compacted parts to head summaries (shrink the DB)",
  instance: false,
  handler: Effect.fn("Cli.db.compact")(function* () {
    const { db } = yield* Database.Service
    // 一次性维护命令：遍历投影表 part，找到已标记 compacted（state.time.compacted
    // 存在）的完成工具输出，把超长 output 静态截断为头部摘要——与运行时
    // markCompacted 的摘要式压缩对齐。已 compacted 的 part 不再参与推理输出
    // （aggregateToolCaps/serialization 均跳过其全文），截断是非破坏性的：
    // 即使未来被事件重放覆盖也只会恢复原文（数据不丢），最坏只是体积回升。
    // 不写 event 事件：part 表是投影，实际运行路径从表读，重放不依赖全文。
    // 分批扫描避免一次载入 174MB 到内存。
    let offset = 0
    let scanned = 0
    let truncated = 0
    let freedBytes = 0
    for (;;) {
      const rows = yield* db
        .all<{ id: string; data: string }>(
          sql.raw(`SELECT id, data FROM part ORDER BY rowid LIMIT ${PART_BATCH} OFFSET ${offset}`),
        )
        .pipe(Effect.orDie)
      if (rows.length === 0) break
      scanned += rows.length
      for (const row of rows) {
        let data: unknown
        try {
          data = JSON.parse(row.data)
        } catch {
          continue
        }
        if (typeof data !== "object" || data === null) continue
        const part = data as Record<string, unknown>
        if (part.type !== "tool") continue
        const state = part.state as Record<string, unknown> | undefined
        if (typeof state !== "object" || state === null) continue
        if (state.status !== "completed") continue
        const time = state.time as Record<string, unknown> | undefined
        if (typeof time !== "object" || time === null) continue
        if (typeof time.compacted !== "number") continue // 只处理已 compact 的存量
        const output = state.output
        if (typeof output !== "string" || output.length <= RETRO_COMPACT_CHARS) continue
        state.output = `${output.slice(0, RETRO_COMPACT_CHARS)}…`
        yield* db
          .run(sql.raw(`UPDATE part SET data = '${JSON.stringify(data).replace(/'/g, "''")}' WHERE id = '${row.id.replace(/'/g, "''")}'`))
          .pipe(Effect.orDie)
        truncated++
        freedBytes += output.length - output.length
      }
      offset += PART_BATCH
      if (rows.length < PART_BATCH) break
    }
    console.log(`scanned ${scanned} parts`)
    console.log(`truncated ${truncated} compacted tool outputs`)
    console.log(`freed ~${(freedBytes / 1024 / 1024).toFixed(1)} MB in part table`)
    console.log("run `gyc db cleanup` afterwards to VACUUM and reclaim the file size")
  }),
})
const CacheCommand = effectCmd({
  command: "cache",
  describe: "report recent prompt-cache hit rate from persisted message tokens",
  instance: false,
  handler: Effect.fn("Cli.db.cache")(function* () {
    const { db } = yield* Database.Service
    const rows = yield* db
      .all<{ data: string; time_created: number | string }>(
        sql.raw(`SELECT data, time_created FROM message ORDER BY time_created DESC LIMIT 50`),
      )
      .pipe(Effect.orDie)
    let input = 0
    let cacheRead = 0
    let withTokens = 0
    const perMessage: { time: number; total: number; cached: number }[] = []
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
        perMessage.push({ time: Number(row.time_created), total: totalInput, cached: t.cache?.read ?? 0 })
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
    console.log(`total input tokens: ${input.toLocaleString()}`)
    console.log(`cache-read tokens: ${cacheRead.toLocaleString()}`)
    console.log(`prompt-cache hit rate: ${rate}%`)
    if (rate === "0.0" && input > 0) {
      console.log("note: 0% suggests the current model/provider does not report prompt caching,")
      console.log("or the system-prompt prefix changes between requests.")
    }

    // Per-message trend (oldest → newest): a stable prefix shows ~99% on every
    // row; a row that collapses to ~0% while neighbours stay high marks the
    // exact turn where the prefix drifted (memory/skills/env/tools change).
    const asc = perMessage.reverse()
    console.log("")
    console.log(`per-message hit rate (oldest → newest, last ${asc.length}):`)
    asc.forEach((m, i) => {
      const ratio = m.total > 0 ? m.cached / m.total : 0
      const r = (ratio * 100).toFixed(1)
      const prev = i > 0 ? asc[i - 1] : undefined
      const prevRatio = prev && prev.total > 0 ? prev.cached / prev.total : 1
      const flag = ratio < 0.2 && prevRatio >= 0.8 ? "  ← 前缀漂移疑似（该轮前缀与上轮不同）" : ""
      const time = new Date(m.time).toLocaleTimeString()
      console.log(
        `  ${String(i + 1).padStart(3)}. ${time}  ${r.padStart(5)}%  (${m.cached.toLocaleString()} / ${m.total.toLocaleString()})${flag}`,
      )
    })
  }),
})
export const DbCommand = effectCmd({
  command: "db",
  describe: "database tools",
  instance: false,
  builder: (yargs: Argv) => {
    return yargs
      .command(QueryCommand)
      .command(PathCommand)
      .command(CleanupCommand)
      .command(CompactCommand)
      .command(CacheCommand)
      .demandCommand()
  },
  handler: Effect.fn("Cli.db")(function* () {}),
})
