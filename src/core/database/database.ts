export * as Database from "./database"

import { EffectDrizzleSqlite } from "@gyccode/effect-drizzle-sqlite"
import { layer as sqliteLayer } from "#sqlite"
import { Context, Effect, Layer } from "effect"
import { sql } from "drizzle-orm"
import { Global } from "../global"
import { Flag } from "../flag/flag"
import { isAbsolute, join } from "path"
import { readFileSync, writeFileSync, readdirSync, statSync, rmSync } from "node:fs"
import { DatabaseMigration } from "./migration"
import { selectPruneTargetCount } from "./prune-targets"
import { InstallationChannel } from "../installation/version"
import { makeGlobalNode } from "../effect/app-node"

const makeDatabase = EffectDrizzleSqlite.makeWithDefaults()
type DatabaseShape = Effect.Success<typeof makeDatabase>

// INCREMENTAL auto-vacuum reclaims freed pages into the freelist on demand
// (incremental_vacuum) instead of letting deleted rows leave permanent holes
// in the db file. It must be enabled before the first table is created to
// apply to new databases; existing databases need a one-time full VACUUM to
// take effect (PRAGMA auto_vacuum returns 0 until then).
const enableIncrementalVacuum = Effect.fn("Database.enableIncrementalVacuum")(function* (db: DatabaseShape) {
  yield* db.run(sql`PRAGMA auto_vacuum = INCREMENTAL`).pipe(
    Effect.catch((e) =>
      Effect.logError("Failed to enable incremental vacuum", { error: e })
    )
  )
  const row = yield* db.get<{ auto_vacuum: number }>(sql`PRAGMA auto_vacuum`).pipe(
    Effect.catch((e) =>
      Effect.logError("Failed to get auto_vacuum", { error: e })
    )
  )
  if (row?.auto_vacuum !== 2) {
    // Existing database: one-time full VACUUM to rebuild with auto-vacuum on.
    yield* db.run(sql`VACUUM`).pipe(
      Effect.catch((e) =>
        Effect.logError("Failed to vacuum", { error: e })
      )
    )
  }
})

// 与 compaction.ts 的 TOOL_OUTPUT_MAX_CHARS 对齐：存量 compacted part 的
// 超长工具输出截断保留的头部摘要长度。
const RETRO_COMPACT_CHARS = 2_000
const PART_BATCH = 500

// 把已标记 compacted（state.time.compacted 存在）的完成工具输出静态截断为
// 头部摘要：与运行时 markCompacted 的摘要式压缩对齐。已 compacted 的 part
// 不再参与推理输出（aggregateToolCaps/serialization 均跳过其全文），截断是
// 非破坏性的——即使被事件重放覆盖也会恢复原文，最坏只是体积回升。
// part 表是投影，运行路径从表读，故不写 event 事件。分批扫描避免一次载入
// 上百 MB 到内存。原为 `gyc db compact` 手动命令，现并入每日维护自动执行，
// 冷启动路径保持保守（限频每日一次，见 maintenanceDue）。
export const compactRetroParts = Effect.fn("Database.compactRetroParts")(function* (
  db: DatabaseShape,
  // 维护路径限量：扫描超过该批数即停止，防极端大库在冷启动路径耗时过长。
  // 手动命令（`gyc db compact`）默认不限，扫全表。
  maxBatch = Number.POSITIVE_INFINITY,
) {
  let offset = 0
  let scanned = 0
  let truncated = 0
  let freedBytes = 0
  let batches = 0
  for (;;) {
    if (batches >= maxBatch) break
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
    batches++
    if (rows.length < PART_BATCH) break
  }
  return { scanned, truncated, freedBytes, batches }
})

// Reclaim freelist pages freed by deletes/updates since the last run. Cheap
// and incremental, so it can run on every startup without blocking reads.
const reclaimFreePages = Effect.fn("Database.reclaimFreePages")(function* (db: DatabaseShape) {
  yield* db.run(sql`PRAGMA incremental_vacuum`).pipe(
    Effect.catch((e) =>
      Effect.logError("Failed to reclaim free pages", { error: e })
    )
  )
})

// Prune raw event rows for sessions that have been inactive beyond the
// retention window. Projection tables (session_message, part, todo, …) retain
// all data, so message history is preserved; only the event-sourcing log is
// trimmed. The event_sequence rows are intentionally kept so workspace sync
// still knows each aggregate's latest seq and does not re-deliver history.
// This bounds the event table size and, combined with incremental_vacuum,
// keeps the database file from growing unboundedly.
//
// Retention is time-based (7 days — the log is only a replay source, the
// projections keep full history) AND size-based: if the event log still
// exceeds EVENT_LOG_MAX_BYTES after time pruning (an actively used install
// never goes idle), events of the least-recently-updated sessions are dropped
// in bulk until under the cap. Measured baseline: 10 days of heavy use ≈ 46MB
// of event rows, so 32MB ≈ one week of active history — enough for resume
// while keeping the whole DB well under 100MB even on always-active machines.
const EVENT_RETENTION_MS = 7 * 24 * 60 * 60 * 1000 // 7 days
const EVENT_LOG_MAX_BYTES = 32 * 1024 * 1024 // 32MB hard cap on the event log
export const pruneStaleEvents = Effect.fn("Database.pruneStaleEvents")(function* (
  db: DatabaseShape,
  // capBytes 只为测试可注入；生产路径一律走 EVENT_LOG_MAX_BYTES。
  capBytes = EVENT_LOG_MAX_BYTES,
) {
  const tableExists = yield* db
    .get<{ name: string }>(sql`SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'session'`)
    .pipe(
      Effect.catch((e) =>
        Effect.logError("Failed to check session table existence", { error: e })
      )
    )
  if (!tableExists) return
  const cutoff = Date.now() - EVENT_RETENTION_MS
  // event.aggregate_id is the session id; prune event rows only, keeping
  // event_sequence intact to preserve sync seq tracking.
  yield* db
    .run(sql`
      DELETE FROM event
      WHERE aggregate_id IN (
        SELECT id FROM session WHERE time_updated < ${cutoff}
      )
    `)
    .pipe(
      Effect.catch((e) =>
        Effect.logError("Failed to prune stale events by time", { error: e })
      )
    )

  // Size cap: drop the oldest sessions' events in ONE batch, oldest activity
  // first, until the event log is under the cap. Same semantics as time
  // pruning above. 旧实现是 while 循环里一次只删一个会话，且每轮重跑一次
  // SUM(LENGTH(data)) 全表统计：实测单次启动删 79 个会话、耗时 36.7 秒，全部
  // 同步阻塞在 Database layer 构造期（即冷启动路径）。现在先把「要删几个」
  // 一次算清（selectPruneTargetCount），再用带 LIMIT 的单条 DELETE 落地。
  while (true) {
    const total = yield* db.get<{ b: number | null }>(sql`SELECT SUM(LENGTH(data)) AS b FROM event`).pipe(
      Effect.catch((e) =>
        Effect.logError("Failed to get event log size", { error: e })
      )
    )
    const over = (total?.b ?? 0) - capBytes
    if (over <= 0) return
    const sessions = yield* db
      .all<{ id: string; bytes: number }>(sql`
        SELECT e.aggregate_id AS id, SUM(LENGTH(e.data)) AS bytes
        FROM event e
        JOIN session s ON s.id = e.aggregate_id
        GROUP BY e.aggregate_id
        ORDER BY MIN(s.time_updated) ASC
      `)
      .pipe(
        Effect.catch((e) =>
          Effect.logError("Failed to group event bytes by session", { error: e })
        )
      )
    const limit = selectPruneTargetCount(sessions ?? [], over)
    // 没有可裁剪的会话（全部是孤儿 aggregate_id）：再循环也不会变小，直接退出。
    if (limit === 0) return
    yield* Effect.logWarning("event log over size cap, pruning oldest session events", {
      sessions: limit,
      overBytes: over,
      cap: capBytes,
    })
    // P1 修复：删除全部事件时同时删除序列号，防止孤立序列号导致 sync 从不存在的序列号恢复
    // 两条语句用同一个子查询（都从 event 表派生 victim），所以顺序不可交换：
    // 先删 event_sequence 再删 event。反过来写的话，第二条的子查询会因 event
    // 已清空而匹配不到任何行，序列号一条都删不掉（集成测试守这条）。
    yield* db
      .run(sql`
        DELETE FROM event_sequence WHERE aggregate_id IN (
          SELECT e.aggregate_id FROM event e
          JOIN session s ON s.id = e.aggregate_id
          GROUP BY e.aggregate_id
          ORDER BY MIN(s.time_updated) ASC
          LIMIT ${limit}
        )
      `)
      .pipe(
        Effect.catch((e) =>
          Effect.logError("Failed to delete victim session sequence", { error: e })
        )
      )
    yield* db
      .run(sql`
        DELETE FROM event WHERE aggregate_id IN (
          SELECT e.aggregate_id FROM event e
          JOIN session s ON s.id = e.aggregate_id
          GROUP BY e.aggregate_id
          ORDER BY MIN(s.time_updated) ASC
          LIMIT ${limit}
        )
      `)
      .pipe(
        Effect.catch((e) =>
          Effect.logError("Failed to delete victim session events", { error: e })
        )
      )
  }
})

export interface Interface {
  db: DatabaseShape
}

export class Service extends Context.Service<Service, Interface>()("@gyccode/v2/storage/Database") {}

// 重维护（事件裁剪 + incremental_vacuum + TRUNCATE checkpoint）限频为每日
// 一次：在 100MB+ 的库上每次启动都跑会把数百 ms 的纯写负载（HDD 上更久）
// 加进冷启动路径。小库（<8MB）始终维护，保证新装机器与测试环境的语义
// 不变。标记文件在 data 目录，内容为上次维护的 epoch 毫秒。
const MAINTENANCE_INTERVAL_MS = 24 * 60 * 60 * 1000
const MAINTENANCE_ALWAYS_UNDER_BYTES = 8 * 1024 * 1024
const maintenanceMarker = () => join(Global.Path.data, ".db-maintain")

// 快照 TTL（30 天）：snapshot/<project-id>/<worktree-hash>/ 是 git 内容寻址
// 树（core/snapshot.ts:98），目录 mtime 不一定随 git 对象写入更新，故递归
// 找最大文件 mtime 判定活跃度。超期项目快照整目录删除——影响仅是该项目的
// 历史回滚锚点丢失，项目当前状态不受影响。
const SNAPSHOT_TTL_MS = 30 * 24 * 60 * 60 * 1000

const pruneStaleSnapshots = Effect.fn("Database.pruneStaleSnapshots")(function* () {
  const root = join(Global.Path.data, "snapshot")
  const removed: string[] = []
  yield* Effect.sync(() => {
    let projects: ReturnType<typeof readdirSync> = []
    try {
      projects = readdirSync(root, { withFileTypes: true })
    } catch {
      return // 目录不存在：无快照可清理
    }
    const latestMtime = (dir: string): number => {
      let max = 0
      let entries: ReturnType<typeof readdirSync> = []
      try {
        entries = readdirSync(dir, { withFileTypes: true })
      } catch {
        return 0 // 读取失败（权限/竞态删除）：视为不活跃
      }
      for (const entry of entries) {
        const full = join(dir, entry.name)
        try {
          if (entry.isDirectory()) max = Math.max(max, latestMtime(full))
          else max = Math.max(max, statSync(full).mtimeMs)
        } catch {
          // 单文件 stat 失败（竞态删除/占用）：跳过该文件，不影响整体
        }
      }
      return max
    }
    for (const project of projects) {
      if (!project.isDirectory()) continue
      const dir = join(root, project.name)
      const latest = latestMtime(dir)
      if (latest > 0 && Date.now() - latest > SNAPSHOT_TTL_MS) {
        rmSync(dir, { recursive: true, force: true })
        removed.push(project.name)
      }
    }
  })
  if (removed.length > 0) {
    yield* Effect.logWarning("pruned stale project snapshots", { count: removed.length })
  }
})

const maintenanceDue = Effect.fn("Database.maintenanceDue")(function* (db: DatabaseShape) {
  const size = yield* db
    .get<{ pages: number; page_size: number }>(sql`
      SELECT (SELECT page_count FROM pragma_page_count) AS pages,
             (SELECT page_size FROM pragma_page_size) AS page_size
    `)
    .pipe(
      Effect.catch((e) =>
        Effect.logWarning("Failed to get DB size for maintenanceDue", { error: e }).pipe(
          Effect.andThen(Effect.succeed({ pages: 0, page_size: 0 }))
        )
      )
    )
  if (!size || size.pages * size.page_size < MAINTENANCE_ALWAYS_UNDER_BYTES) return true
  // 用同步 readFileSync 而非 tryPromise：Database layer 会被测试用
  // Effect.runSync 执行，任何异步 Effect 都会让 runSync 崩溃。维护标记
  // 读写在冷启动路径上仅一次，同步 IO 的文件极小，代价可忽略。
  const marker = yield* Effect.sync(() => {
    try {
      return readFileSync(maintenanceMarker(), "utf8")
    } catch {
      return undefined
    }
  })
  const last = marker ? Number.parseInt(marker, 10) : NaN
  if (Number.isFinite(last) && Date.now() - last < MAINTENANCE_INTERVAL_MS) return false
  return true
})

const markMaintenance = () =>
  Effect.sync(() => {
    writeFileSync(maintenanceMarker(), String(Date.now()), "utf8")
  }).pipe(
    // 标记写失败（EACCES / ENOTDIR / 只读数据目录）时不能静默：限频失效意味着
    // 每次启动都会重跑 pruneStaleEvents + reclaimFreePages + wal_checkpoint(TRUNCATE)，
    // 大库上表现为启动期长阻塞与磁盘 I/O 抖动。必须留痕。
    Effect.catchCause((cause) =>
      Effect.logWarning("维护限频标记写入失败：本次维护将在下次启动时重复执行", { cause: cause }),
    ),
  )

const layer = Layer.effect(
  Service,
  Effect.gen(function* () {
    const db = yield* makeDatabase

    yield* db.run("PRAGMA journal_mode = WAL")
    yield* db.run("PRAGMA synchronous = NORMAL")
    yield* db.run("PRAGMA busy_timeout = 5000")
    // 4MB page cache bound to reduce fixed memory footprint on low-RAM machines.
    yield* db.run("PRAGMA cache_size = -4000")
    yield* db.run("PRAGMA foreign_keys = ON")
    yield* enableIncrementalVacuum(db)
    yield* DatabaseMigration.apply(db)
    // Prune stale event rows after migrations (tables guaranteed to exist) and
    // before reclaimFreePages so the freed pages are vacuumed in the same pass.
    if (yield* maintenanceDue(db)) {
      // 先截断已 compacted 长工具输出（释放 part 表空间），再裁剪事件日志，
      // 两者释放的页在同一次 incremental_vacuum 回收。
      const compact = yield* compactRetroParts(db, 200).pipe(
        Effect.catch((e) =>
          Effect.logError("Failed to compact retro parts", { error: e }).pipe(Effect.succeed({ scanned: 0, truncated: 0, freedBytes: 0, batches: 0 }))
        )
      )
      if (compact.truncated > 0) {
        yield* Effect.logWarning("daily maintenance compacted long tool outputs", compact)
      }
      yield* pruneStaleEvents(db)
      yield* pruneStaleSnapshots().pipe(
        Effect.catch((e) => Effect.logError("Failed to prune stale snapshots", { error: e })),
      )
      yield* reclaimFreePages(db)
      yield* db.run("PRAGMA wal_checkpoint(TRUNCATE)")
      yield* markMaintenance()
    }

    return { db }
  }).pipe(Effect.orDie),
)

export function layerFromPath(filename: string) {
  return layer.pipe(Layer.provide(sqliteLayer({ filename })))
}

export const testLayer = layerFromPath(":memory:")

export function path() {
  if (Flag.GYCCODE_DB) {
    if (Flag.GYCCODE_DB === ":memory:" || isAbsolute(Flag.GYCCODE_DB)) return Flag.GYCCODE_DB
    return join(Global.Path.data, Flag.GYCCODE_DB)
  }
  if (
    ["latest", "beta", "prod"].includes(InstallationChannel) ||
    process.env.GYCCODE_DISABLE_CHANNEL_DB === "1" ||
    process.env.GYCCODE_DISABLE_CHANNEL_DB === "true"
  )
    return join(Global.Path.data, "gyccode.db")
  return join(Global.Path.data, `gyccode-${InstallationChannel.replace(/[^a-zA-Z0-9._-]/g, "-")}.db`)
}

export const node = makeGlobalNode({ service: Service, layer: layerFromPath(path()), deps: [] })
