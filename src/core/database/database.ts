export * as Database from "./database"

import { EffectDrizzleSqlite } from "@gyccode/effect-drizzle-sqlite"
import { layer as sqliteLayer } from "#sqlite"
import { Context, Effect, Layer } from "effect"
import { sql } from "drizzle-orm"
import { Global } from "../global"
import { Flag } from "../flag/flag"
import { isAbsolute, join } from "path"
import { readFileSync, writeFileSync } from "node:fs"
import { DatabaseMigration } from "./migration"
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
const pruneStaleEvents = Effect.fn("Database.pruneStaleEvents")(function* (db: DatabaseShape) {
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

  // Size cap: drop whole sessions' events, oldest activity first, until the
  // event log is under the cap. Same semantics as time pruning above.
  while (true) {
    const total = yield* db.get<{ b: number | null }>(sql`SELECT SUM(LENGTH(data)) AS b FROM event`).pipe(
      Effect.catch((e) =>
        Effect.logError("Failed to get event log size", { error: e })
      )
    )
    if ((total?.b ?? 0) <= EVENT_LOG_MAX_BYTES) return
    const victim = yield* db
      .get<{ id: string; b: number }>(sql`
        SELECT e.aggregate_id AS id, SUM(LENGTH(e.data)) AS b
        FROM event e
        JOIN session s ON s.id = e.aggregate_id
        GROUP BY e.aggregate_id
        ORDER BY MIN(s.time_updated) ASC
        LIMIT 1
      `)
      .pipe(
        Effect.catch((e) =>
          Effect.logError("Failed to find victim session for size pruning", { error: e })
        )
      )
    if (!victim) return
    yield* Effect.logWarning("event log over size cap, pruning oldest session events", {
      sessionID: victim.id,
      bytes: victim.b,
      cap: EVENT_LOG_MAX_BYTES,
    })
    yield* db.run(sql`DELETE FROM event WHERE aggregate_id = ${victim.id}`).pipe(
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
    try {
      writeFileSync(maintenanceMarker(), String(Date.now()), "utf8")
    } catch {
      // 忽略写失败：维护标记仅是限频优化，失败不影响数据库语义
    }
  })

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
      yield* pruneStaleEvents(db)
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
