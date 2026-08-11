#!/usr/bin/env bun
// gyc-cli data dir maintenance script
//
// Usage (from repo root):
//   bun scripts/maintain-data.mjs               # dry-run: report storage usage (modifies nothing)
//   bun scripts/maintain-data.mjs --checkpoint  # PASSIVE WAL checkpoint on the sqlite db
//   bun scripts/maintain-data.mjs --clean       # remove artifacts older than 7-day retention (old logs / .bak)
//
// Safety:
//   - Default is dry-run; never modifies files unless --clean
//   - --clean only removes `.bak*` and `log/gyccode.log.N` older than 7 days
//   - Fresh backups (e.g. today's gyccode-local.db.bak-sessionclean-*) are never touched
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
    const dbRow = rows.find((r) => r.kind === "db" && r.name.endsWith(".db") && !r.name.includes("-wal") && !r.name.includes("-shm"))
    const dbPath = dbRow ? join(DATA_DIR, dbRow.name) : join(DATA_DIR, "gyccode-local.db")
    try {
      const db = new Database(dbPath)
      db.exec("PRAGMA busy_timeout = 5000")
      const res = db.query("PRAGMA wal_checkpoint(PASSIVE)").get()
      console.log(`  checkpoint result: ${JSON.stringify(res)}`)
      db.close()
    } catch (err) {
      console.log(`  checkpoint failed (an instance may be writing): ${err.message}`)
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
    console.log("  run `bun scripts/maintain-data.mjs --checkpoint` to trigger a WAL checkpoint")
  }
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})