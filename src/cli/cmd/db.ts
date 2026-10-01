import type { Argv } from "yargs"
import { spawn } from "child_process"
import { Database } from "@gyccode/core/database/database"
import { Effect } from "effect"
import { sql } from "drizzle-orm"
import { effectCmd } from "../effect-cmd"
import { logWarn } from "@core/observability/log-error"

const QueryCommand = effectCmd({
  command: "query [query]",
  describe: "运行 SQL 查询或打开交互式 sqlite3 shell",
  instance: false,
  builder: (yargs: Argv) => {
    return yargs
      .positional("query", {
        type: "string",
        describe: "要执行的 SQL 查询",
      })
      .option("format", {
        type: "string",
        choices: ["json", "tsv"],
        default: "tsv",
        describe: "输出格式",
      })
  },
  handler: Effect.fn("Cli.db.query")(function* (args: { query?: string; format: string }) {
    const query = args.query as string | undefined
    if (query) {
      const { db } = yield* Database.Service
      const result = yield* db.all<Record<string, unknown>>(sql.raw(query)).pipe(Effect.orDie)
      if (args.format === "json") console.log(JSON.stringify(result, null, 2))
      else if (result.length > 0) {
        const first = result[0]
        if (first === undefined) return
        const keys = Object.keys(first)
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
  describe: "打印数据库路径",
  instance: false,
  handler: Effect.fn("Cli.db.path")(function* () {
    console.log(Database.path())
  }),
})

const CleanupCommand = effectCmd({
  command: "cleanup",
  describe: "删除孤立的持久化事件（不再存在的会话）并执行 VACUUM",
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
  describe: "将已压缩部分中的长工具输出压缩为头部摘要（缩小数据库）",
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
        // 不能把 JSON 直接拼进 SQL 字符串：data 含控制字符/异常内容时会变成
        // 语法错误，orDie 直接把整条命令打崩；改用参数绑定。
        yield* db
          .run(sql`UPDATE part SET data = ${JSON.stringify(data)} WHERE id = ${row.id}`)
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

// C-07：实现已上移到 @gyccode/core/session/cache-rate —— TUI 的 dialog-cost
// 也要用同一份口径，而 TUI 作为独立 workspace 包不能反向依赖 src/cli。
// 此处 import 供本文件使用、再导出以保持既有 import 路径（./db）不变。
import {
  promptCacheStats,
  classifyMiss,
  CACHE_WINDOW_MS,
  type CacheRowLike,
  type PerMessageRow,
} from "@gyccode/core/session/cache-rate"

export {
  promptCacheStats,
  classifyMiss,
  CACHE_WINDOW_MS,
  type CacheRowLike,
  type PromptCacheStats,
  type PerMessageRow,
  type CacheMissCause,
} from "@gyccode/core/session/cache-rate"

const CacheCommand = effectCmd({
  command: "cache",
  describe: "根据已持久化的消息 token 报告近期的提示缓存命中率",
  instance: false,
  handler: Effect.fn("Cli.db.cache")(function* () {
    const { db } = yield* Database.Service
    const rows = yield* db
      .all<{ data: string; time_created: number | string }>(
        sql.raw(`SELECT data, time_created, session_id FROM message ORDER BY time_created DESC LIMIT 50`),
      )
      .pipe(Effect.orDie)
    const stats = promptCacheStats(rows)
    if (stats.withTokens === 0) {
      console.log("最近 50 条消息中未持久化任何 token 用量")
      return
    }
    const rate = stats.totalInput > 0 ? ((stats.cacheRead / stats.totalInput) * 100).toFixed(1) : "0.0"
    const prefixRate =
      stats.prefixBase > 0 ? ((stats.prefixHit / stats.prefixBase) * 100).toFixed(1) : "n/a"
    const steadyRate =
      stats.steadyBase > 0 ? ((stats.steadyHit / stats.steadyBase) * 100).toFixed(1) : "n/a"
    console.log(`含用量的消息数：${stats.withTokens}`)
    console.log(`总输入 token：${stats.totalInput.toLocaleString()}`)
    console.log(`缓存读取 token：${stats.cacheRead.toLocaleString()}`)
    console.log(`prompt 缓存命中率（含新增）：${rate}%`)
    console.log(`前缀命中率（窗口内）：${prefixRate}%  ← 含漂移事件行，新增与窗口过期不计入`)
    console.log(`稳态前缀命中率（剔除漂移行）：${steadyRate}%  ← 健康线 ≥99.5%；漂移事件见下方逐条标注`)
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
      if (cause === "partial-drift") {
        const gap = Math.max(0, Math.min(prev!.total, m.total) - m.cached)
        logWarn("cli.db.cache", "检测到前缀部分漂移", {
          gapTokens: gap,
          prevTotal: prev!.total,
          curTotal: m.total,
          curCached: m.cached,
          time: m.time,
        })
      }
      const r = m.total > 0 ? ((m.cached / m.total) * 100).toFixed(1) : "0.0"
      const flag =
        cause === "window-expiry"
          ? "  ← 缓存窗口过期（与上轮间隔超过服务商缓存窗口，属物理 miss）"
          : cause === "drift"
            ? "  ← 前缀漂移疑似（该轮前缀与上轮不同，排查记忆/技能/指令/工具集变化）"
            : cause === "partial-drift"
              ? `  ← 前缀部分漂移疑似（窗口内较上轮总输入丢 ${Math.max(0, Math.min(asc[i - 1]!.total, m.total) - m.cached).toLocaleString()} token，排查记忆/指令/工具集变化）`
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
  describe: "数据库工具",
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
