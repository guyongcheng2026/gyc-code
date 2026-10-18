#!/usr/bin/env bun
// 超长会话加载基准（只读，不触生产库）
// 用法：bun scripts/bench-long-session.mjs --db <path> --session <id> [--runs 5]
// 装配与生产一致：@effect/sql-sqlite-bun SqlClient + EffectDrizzleSqlite.makeWithDefaults()
// 输出：load 中位/P95、消息与 tool part 计数、running 残留（经对账后必须为 0）、RSS
import { Effect } from "effect"
import { SqliteClient } from "@effect/sql-sqlite-bun"
import { EffectDrizzleSqlite } from "@gyccode/effect-drizzle-sqlite"
import { SessionHistory } from "../src/core/session/history"

const args = {}
for (let i = 2; i < process.argv.length; i++) {
  const k = process.argv[i]
  if (!k.startsWith("--")) continue
  const next = process.argv[i + 1]
  args[k.slice(2)] = next && !next.startsWith("--") ? next : true
}
const dbPath = args.db
const sessionID = args.session
const runs = Number(args.runs ?? 5)
if (!dbPath || !sessionID) {
  console.error("[bench] 需要 --db 与 --session")
  process.exit(2)
}

const median = (xs) => [...xs].sort((a, b) => a - b)[Math.floor(xs.length / 2)]
const pct95 = (xs) => [...xs].sort((a, b) => a - b)[Math.min(xs.length - 1, Math.ceil(xs.length * 0.95) - 1)]

const program = Effect.gen(function* () {
  const db = yield* EffectDrizzleSqlite.makeWithDefaults()

  const statsOf = (msgs) => {
    const s = { messages: msgs.length, toolParts: 0, runningAfterLoad: 0 }
    for (const m of msgs) {
      if (m.type !== "assistant") continue
      for (const part of m.content) {
        if (part.type !== "tool") continue
        s.toolParts++
        if (part.state.status === "running") s.runningAfterLoad++
      }
    }
    return s
  }

  yield* SessionHistory.load(db, sessionID) // 预热
  const times = []
  let stats = null
  for (let i = 0; i < runs; i++) {
    const t0 = performance.now()
    const msgs = yield* SessionHistory.load(db, sessionID)
    times.push(performance.now() - t0)
    stats = statsOf(msgs)
  }

  console.log(
    JSON.stringify(
      {
        db: dbPath,
        session: sessionID,
        runs,
        loadMs: {
          median: Math.round(median(times)),
          p95: Math.round(pct95(times)),
          min: Math.round(Math.min(...times)),
          max: Math.round(Math.max(...times)),
        },
        ...stats,
        rssMB: Math.round(process.memoryUsage.rss() / 1024 / 1024),
      },
      null,
      2,
    ),
  )
  if (stats.runningAfterLoad !== 0) {
    console.error("[bench] U-3 对账失败：加载后仍有 running 残留")
    process.exit(1)
  }
}).pipe(Effect.provide(SqliteClient.layer({ filename: dbPath })))

await Effect.runPromise(program)