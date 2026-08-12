export * as Database from "./database"

import { EffectDrizzleSqlite } from "@gyccode/effect-drizzle-sqlite"
import { layer as sqliteLayer } from "#sqlite"
import { Context, Effect, Layer } from "effect"
import { sql } from "drizzle-orm"
import { Global } from "../global"
import { Flag } from "../flag/flag"
import { isAbsolute, join } from "path"
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
  yield* db.run(sql`PRAGMA auto_vacuum = INCREMENTAL`).pipe(Effect.orDie)
  const row = yield* db.get<{ auto_vacuum: number }>(sql`PRAGMA auto_vacuum`).pipe(Effect.orDie)
  if (row?.auto_vacuum !== 2) {
    // Existing database: one-time full VACUUM to rebuild with auto-vacuum on.
    yield* db.run(sql`VACUUM`).pipe(Effect.orDie)
  }
})

// Reclaim freelist pages freed by deletes/updates since the last run. Cheap
// and incremental, so it can run on every startup without blocking reads.
const reclaimFreePages = Effect.fn("Database.reclaimFreePages")(function* (db: DatabaseShape) {
  yield* db.run(sql`PRAGMA incremental_vacuum`).pipe(Effect.orDie)
})

// Prune raw event rows for sessions that have been inactive beyond the
// retention window. Projection tables (session_message, part, todo, …) retain
// all data, so message history is preserved; only the event-sourcing log is
// trimmed. The event_sequence rows are intentionally kept so workspace sync
// still knows each aggregate's latest seq and does not re-deliver history.
// This bounds the event table size and, combined with incremental_vacuum,
// keeps the database file from growing unboundedly.
const EVENT_RETENTION_MS = 30 * 24 * 60 * 60 * 1000 // 30 days
const pruneStaleEvents = Effect.fn("Database.pruneStaleEvents")(function* (db: DatabaseShape) {
  const tableExists = yield* db
    .get<{ name: string }>(sql`SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'session'`)
    .pipe(Effect.orDie)
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
    .pipe(Effect.orDie)
})

export interface Interface {
  db: DatabaseShape
}

export class Service extends Context.Service<Service, Interface>()("@gyccode/v2/storage/Database") {}

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
    yield* pruneStaleEvents(db)
    yield* reclaimFreePages(db)
    yield* db.run("PRAGMA wal_checkpoint(TRUNCATE)")

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
