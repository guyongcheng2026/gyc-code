#!/usr/bin/env bun
// gyc-cli data dir maintenance script
//
// Usage (from repo root):
//   bun scripts/maintain-data.mjs                    # dry-run: report storage usage (modifies nothing)
//   bun scripts/maintain-data.mjs --checkpoint       # PASSIVE WAL checkpoint on the sqlite db
//   bun scripts/maintain-data.mjs --clean            # remove artifacts older than 7-day retention (old logs / .bak)
//   bun scripts/maintain-data.mjs --prune-events[=H] # event-delta retention: dry-run report unless --clean
//
// --prune-events[=H]  (default H=24):
//   Prunes redundant `message.part.updated.*` streaming snapshots for sessions whose last event is
//   older than H hours. ALWAYS keeps the latest event per (session, part) so the final state of every
//   part remains in the event history. The materialized part/message tables are the source of truth
//   for the TUI, so removing intermediate deltas is safe for sync/replay.
//   Without --clean this only reports candidate count/bytes (no writes).
//
// Safety:
//   - Default is dry-run; never modifies files/db unless --clean
//   - --clean removes only `.bak*` and `log/gyccode.log.N` older than 7 days, and (with
//     --prune-events) applies the event-delta prune
//   - tool-output is managed by the app ToolOutputStore (7-day retention), untouched here

import { Database } from "bun:sqlite"
import { homedir } from "os"
import { join } from "path"
import { readdir, stat, unlink } from "fs/promises"

const DATA_DIR = process.env.GYCCODE_DATA_DIR || join(homedir(), ".local", "share", "gyccode")
const LOG_DIR = join(DATA_DIR, "log")
const RETENTION_MS = 7 * 24 * 60 * 60 * 1000
const DRY = !process.argv.includes("--clean")
const CHECKPOINT = process.argv.includes("--checkpoint")
const PRUNE_ARG = process.argv.find((a) => a.startsWith("--prune-events"))
const PRUNE = PRUNE_ARG !== undefined
const PRUNE_HOURS = PRUNE ? Number(PRUNE_ARG.split("=")[1] ?? "24") || 24 : 0

const MB = 1048576

async function exists(p) {
  try {
    await stat(p)
    return true
  } catch {
    return false
  }
}

async function sizeOf(p) {
  try {
    return (await stat(p)).size
  } catch {
    return 0
  }
}

async function mtimeOf(p) {
  try {
    return (await stat(p)).mtimeMs
  } catch {
    return 0
  }
}

const fmtMB = (bytes) => `${(bytes / MB).toFixed(1).padStart(8)} MB`

function openDb() {
  const dbPath = join(DATA_DIR, "gyccode-local.db")
  const db = new Database(dbPath)
  db.exec("PRAGMA busy_timeout = 5000")
  return db
}

function pruneEvents(db, cutoff, apply) {
  // Sessions whose LAST part.updated event is older than the cutoff.
  const summary = db
    .query(
      `SELECT COUNT(*) rows, COALESCE(SUM(length(data)), 0) bytes
       FROM event
       WHERE type LIKE 'message.part.updated.%'
         AND aggregate_id IN (
           SELECT aggregate_id FROM event
           WHERE type LIKE 'message.part.updated.%'
           GROUP BY aggregate_id
           HAVING MAX(json_extract(data, '$.time')) < ?
         )
         AND (aggregate_id, seq) NOT IN (
           SELECT aggregate_id, MAX(seq) FROM event
           WHERE type LIKE 'message.part.updated.%'
           GROUP BY aggregate_id, json_extract(data, '$.part.id')
         )`,
    )
    .get(cutoff)
  const rows = summary?.rows ?? 0
  const bytes = summary?.bytes ?? 0
  console.log(`  candidate part.updated deltas: ${rows} rows, ${fmtMB(bytes)}`)

  const affected = db
    .query(
      `SELECT aggregate_id, COUNT(*) rows, SUM(length(data)) bytes
       FROM event
       WHERE type LIKE 'message.part.updated.%'
         AND aggregate_id IN (
           SELECT aggregate_id FROM event
           WHERE type LIKE 'message.part.updated.%'
           GROUP BY aggregate_id
           HAVING MAX(json_extract(data, '$.time')) < ?
         )
         AND (aggregate_id, seq) NOT IN (
           SELECT aggregate_id, MAX(seq) FROM event
           WHERE type LIKE 'message.part.updated.%'
           GROUP BY aggregate_id, json_extract(data, '$.part.id')
         )
       GROUP BY aggregate_id ORDER BY bytes DESC LIMIT 10`,
    )
    .all(cutoff)
  for (const a of affected) console.log(`    - ${a.aggregate_id}: ${a.rows} rows, ${fmtMB(a.bytes)}`)

  if (apply && rows > 0) {
    db.query("BEGIN").run()
    try {
      db.query(
        `DELETE FROM event
         WHERE type LIKE 'message.part.updated.%'
           AND aggregate_id IN (
             SELECT aggregate_id FROM event
             WHERE type LIKE 'message.part.updated.%'
             GROUP BY aggregate_id
             HAVING MAX(json_extract(data, '$.time')) < ?
           )
           AND (aggregate_id, seq) NOT IN (
             SELECT aggregate_id, MAX(seq) FROM event
             WHERE type LIKE 'message.part.updated.%'
             GROUP BY aggregate_id, json_extract(data, '$.part.id')
           )`,
      ).run(cutoff)
      db.query("COMMIT").run()
      console.log(`  applied: deleted ${rows} rows`)
    } catch (err) {
      db.query("ROLLBACK").run()
      throw err
    }
  } else if (rows > 0) {
    console.log("  dry-run: add --clean to apply")
  }
}

async function main() {
  console.log(`gyc-cli data dir: ${DATA_DIR}`)
  console.log(`mode: ${DRY ? "dry-run (read-only report)" : "clean"}`)
  console.log("")

  const rows = []
  const dbFiles = ["gyccode-local.db", "gyccode.db", "gyccode-local.db-wal", "gyccode.db-wal",
    "gyccode-local.db-shm", "gyccode.db-shm", "auth.json"]
  for (const name of dbFiles) {
    const p = join(DATA_DIR, name)
    if (await exists(p)) rows.push({ name, bytes: await sizeOf(p), kind: "db" })
  }

  const bakFiles = []
  for (const name of await readdir(DATA_DIR).catch(() => [])) {
    if (name.includes(".bak")) {
      const p = join(DATA_DIR, name)
      bakFiles.push({ name, bytes: await sizeOf(p), mtime: await mtimeOf(p), path: p })
    }
  }
  for (const b of bakFiles) rows.push({ name: b.name, bytes: b.bytes, kind: "bak" })

  const logs = []
  for (const name of await readdir(LOG_DIR).catch(() => [])) {
    const p = join(LOG_DIR, name)
    logs.push({ name: `log/${name}`, bytes: await sizeOf(p), mtime: await mtimeOf(p), path: p })
  }
  for (const l of logs) rows.push({ name: l.name, bytes: l.bytes, kind: "log" })

  let toBytes = 0
  let toCount = 0
  for (const name of await readdir(join(DATA_DIR, "tool-output")).catch(() => [])) {
    toBytes += await sizeOf(join(DATA_DIR, "tool-output", name))
    toCount++
  }
  if (toCount) rows.push({ name: "tool-output/", bytes: toBytes, kind: "tool-output", count: toCount })

  rows.sort((a, b) => b.bytes - a.bytes)
  let total = 0
  for (const r of rows) {
    console.log(`  ${fmtMB(r.bytes)}  ${r.name}${r.count ? ` (${r.count} files)` : ""}`)
    total += r.bytes
  }
  console.log(`  ${fmtMB(total)}  total`)

  if (CHECKPOINT) {
    console.log("\n== WAL checkpoint (PASSIVE) ==")
    try {
      const db = openDb()
      const res = db.query("PRAGMA wal_checkpoint(PASSIVE)").get()
      console.log(`  checkpoint result: ${JSON.stringify(res)}`)
      db.close()
    } catch (err) {
      console.log(`  checkpoint failed (an instance may be writing): ${err.message}`)
    }
  }

  if (PRUNE) {
    console.log(`\n== event-delta retention (sessions idle > ${PRUNE_HOURS}h) ==`)
    try {
      const db = openDb()
      pruneEvents(db, Date.now() - PRUNE_HOURS * 3600000, !DRY)
      db.close()
    } catch (err) {
      console.log(`  prune failed: ${err.message}`)
    }
  }

  if (!DRY) {
    console.log("\n== clean (only removes artifacts older than 7-day retention) ==")
    const now = Date.now()
    let freed = 0
    for (const b of bakFiles) {
      if (b.mtime && now - b.mtime > RETENTION_MS) {
        await unlink(b.path)
        console.log(`  removed ${b.name} (${fmtMB(b.bytes)})`)
        freed += b.bytes
      }
    }
    for (const l of logs) {
      if (/\.log\.\d+$/.test(l.name) && l.mtime && now - l.mtime > RETENTION_MS) {
        await unlink(l.path)
        console.log(`  removed ${l.name} (${fmtMB(l.bytes)})`)
        freed += l.bytes
      }
    }
    console.log(`  freed ${fmtMB(freed)}`)
  } else {
    console.log("\nsuggestions (dry-run, nothing changed):")
    for (const b of bakFiles) {
      const days = Math.floor((Date.now() - b.mtime) / 86400000)
      console.log(`  - .bak backup ${b.name}: ${fmtMB(b.bytes)}, ${days} day(s) old. Run --clean after 7 days to auto-remove`)
    }
    const bigLog = logs.find((l) => l.bytes > MB)
    if (bigLog) console.log(`  - log ${bigLog.name}: ${fmtMB(bigLog.bytes)}; run --clean after 7 days to auto-remove`)
    if (!PRUNE) console.log("  run `bun scripts/maintain-data.mjs --prune-events` to review event-delta retention")
    console.log("  run `bun scripts/maintain-data.mjs --checkpoint` to trigger a WAL checkpoint")
  }
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})