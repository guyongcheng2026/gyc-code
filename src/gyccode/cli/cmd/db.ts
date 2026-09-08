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
    console.log("已删除孤立事件并完成 VACUUM")
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
        freedBytes += output.length - RETRO_COMPACT_CHARS
      }
      offset += PART_BATCH
      if (rows.length < PART_BATCH) break
    }
    console.log(`共扫描 ${scanned} 个 part`)
    console.log(`已截断 ${truncated} 条已压缩的工具输出`)
    console.log(`part 表内释放约 ${(freedBytes / 1024 / 1024).toFixed(1)} MB`)
    console.log("随后可运行 `gyc db cleanup` 执行 VACUUM 以回收文件大小")
  }),
})

export interface CacheRowLike {
  data: string
  time_created?: number | string
}

export interface PromptCacheStats {
  /** 含可解析 token 用量的消息数 */
  withTokens: number
  /** 总输入 token（含缓存命中），命中率分母 */
  totalInput: number
  /** 缓存命中读取 token，命中率分子 */
  cacheRead: number
  perMessage: { time: number; total: number; cached: number }[]
}

/**
 * 统计 prompt 缓存命中率口径（供 `gyc db cache` 使用）。
 *
 * 命中率分母 = 单条"总输入 token（含缓存命中）"= tokens.input + cache.read + cache.write，
 * 恰好还原 provider 上报的完整输入规模。不能用 AI SDK 的 tokens.total 作分母：
 * total 含 output/reasoning token，会把真实 CH 系统性低估（例如 input 10K + output 500，
 * 全命中时按 total=10500 只算出 95.2%，实际应为 100%）。
 */
export function promptCacheStats(rows: CacheRowLike[]): PromptCacheStats {
  let input = 0
  let cacheRead = 0
  let withTokens = 0
  const perMessage: { time: number; total: number; cached: number }[] = []
  for (const row of rows) {
    try {
      const data = JSON.parse(row.data) as {
        tokens?: { input?: unknown; total?: unknown; cache?: { read?: unknown; write?: unknown } }
      }
      const t = data.tokens
      if (!t) continue
      const num = (v: unknown): number => (typeof v === "number" && Number.isFinite(v) ? Math.max(0, v) : 0)
      const cacheReadTokens = num(t.cache?.read)
      const cacheWriteTokens = num(t.cache?.write)
      const netInput = num(t.input)
      const totalInput =
        typeof t.input === "number" && Number.isFinite(t.input)
          ? netInput + cacheReadTokens + cacheWriteTokens
          : num(t.total)
      if (totalInput <= 0) continue
      withTokens++
      input += totalInput
      cacheRead += cacheReadTokens
      perMessage.push({ time: Number(row.time_created ?? 0), total: totalInput, cached: cacheReadTokens })
    } catch {
      // skip malformed rows
    }
  }
  return { withTokens, totalInput: input, cacheRead, perMessage }
}

/** 服务商 prompt 缓存窗口阈值（DeepSeek 等约 5min/1h）。间隔超过它时缓存自然过期，
 * 下一轮必然 miss——即使前缀字节完全未变（物理限制，不是前缀漂移）。 */
export const CACHE_WINDOW_MS = 10 * 60 * 1000

export interface PerMessageRow {
  time: number
  total: number
  cached: number
}

export type CacheMissCause = "window-expiry" | "drift"

/**
 * 分类"该轮近乎全 miss"（ratio < 20% 且上一轮 ≥ 80%）的原因：
 * - window-expiry：与上一轮间隔超过缓存窗口 → 服务商缓存已过期，前缀未变也会 miss
 * - drift：间隔在窗口内却近乎全 miss → 前缀字节确实与上轮不同（记忆/技能/指令/工具集等变化）
 * - null：非明显 miss，或没有上一轮可比（报告窗口首行无法判断，不再误标）
 */
export function classifyMiss(
  prev: PerMessageRow | undefined,
  cur: PerMessageRow,
  windowMs = CACHE_WINDOW_MS,
): CacheMissCause | null {
  if (!prev) return null
  const prevRatio = prev.total > 0 ? prev.cached / prev.total : 1
  const ratio = cur.total > 0 ? cur.cached / cur.total : 0
  if (!(ratio < 0.2 && prevRatio >= 0.8)) return null
  return cur.time - prev.time > windowMs ? "window-expiry" : "drift"
}

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
    const stats = promptCacheStats(rows)
    if (stats.withTokens === 0) {
      console.log("最近 50 条消息中未持久化任何 token 用量")
      return
    }
    const rate = stats.totalInput > 0 ? ((stats.cacheRead / stats.totalInput) * 100).toFixed(1) : "0.0"
    console.log(`含用量的消息数：${stats.withTokens}`)
    console.log(`总输入 token：${stats.totalInput.toLocaleString()}`)
    console.log(`缓存读取 token：${stats.cacheRead.toLocaleString()}`)
    console.log(`prompt 缓存命中率：${rate}%`)
    if (rate === "0.0" && stats.totalInput > 0) {
      console.log("注意：命中率为 0% 说明当前模型/服务商未上报 prompt 缓存，")
      console.log("或系统提示前缀在多次请求间发生了变化。")
    }

    // Per-message trend (oldest → newest): a stable prefix shows ~99% on every
    // row; a row that collapses to ~0% while neighbours stay high marks the
    // turn where the prefix changed. Distinguish "cache window expired"
    // (interval > service cache window → physical miss, prefix intact) from a
    // real prefix drift (memory/skills/env/tools change), so users don't
    // misdiagnose a window expiry as a code-level prefix break.
    const asc = stats.perMessage.reverse()
    console.log("")
    console.log(`逐条命中率（从旧到新，最近 ${asc.length} 条）：`)
    let windowExpired = 0
    asc.forEach((m, i) => {
      const prev = i > 0 ? asc[i - 1] : undefined
      const cause = classifyMiss(prev, m)
      if (cause === "window-expiry") windowExpired++
      const r = m.total > 0 ? ((m.cached / m.total) * 100).toFixed(1) : "0.0"
      const flag =
        cause === "window-expiry"
          ? "  ← 缓存窗口过期（与上轮间隔超过服务商缓存窗口，属物理 miss）"
          : cause === "drift"
            ? "  ← 前缀漂移疑似（该轮前缀与上轮不同，排查记忆/技能/指令/工具集变化）"
            : ""
      const time = new Date(m.time).toLocaleTimeString()
      console.log(
        `  ${String(i + 1).padStart(3)}. ${time}  ${r.padStart(5)}%  (${m.cached.toLocaleString()} / ${m.total.toLocaleString()})${flag}`,
      )
    })
    if (windowExpired > 0) {
      console.log("")
      console.log("提示：部分低命中行与上一轮间隔超过服务商缓存窗口（DeepSeek 等约 5min/1h），")
      console.log("属缓存自然过期而非前缀漂移；命中会续期窗口，持续对话后命中率会回升。")
    }
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
