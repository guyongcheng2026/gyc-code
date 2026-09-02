#!/usr/bin/env node
// scripts/stability-watch.mjs — 长跑稳定性巡检（11 维矩阵·稳定性维度）
// 每次执行：读取 pm2 进程状态（重启计数/存活时长/内存）+ HTTP 探活，
//           追加一行 JSONL 到 stability-log.jsonl，供 1h/4h/8h/24h 检查点判定。
// 判定：Crash = restart_count 相对基线（首检）增长，或 HTTP 探活失败。
// 用法：node scripts/stability-watch.mjs [--port 4300] [--log stability-log.jsonl]
//       建议由计划任务/会话 cron 每 30 分钟执行一次。
import { spawnSync } from "node:child_process"
import { appendFileSync, existsSync, readFileSync, writeFileSync, statSync, renameSync, unlinkSync } from "node:fs"
import { join, dirname } from "node:path"
import { fileURLToPath } from "node:url"

const __dirname = dirname(fileURLToPath(import.meta.url))
const ROOT = join(__dirname, "..")
const argv = process.argv.slice(2)
const argValue = (n, f) => (argv.indexOf(n) >= 0 ? argv[argv.indexOf(n) + 1] ?? f : f)
const PORT = Number(argValue("--port", "4300"))
const LOG = join(ROOT, argValue("--log", "stability-log.jsonl"))
const BASE = `http://127.0.0.1:${PORT}`
const STATE = join(ROOT, "stability-state.json")

const MAX_LOG_SIZE = 512 * 1024
const MAX_LOG_FILES = 3

function rotateLog() {
  if (!existsSync(LOG)) return
  try {
    const stat = statSync(LOG)
    if (stat.size < MAX_LOG_SIZE) return
    for (let i = MAX_LOG_FILES - 1; i >= 1; i--) {
      const from = `${LOG}.${i}`
      const to = `${LOG}.${i + 1}`
      if (existsSync(from)) {
        if (i + 1 >= MAX_LOG_FILES) unlinkSync(from)
        else renameSync(from, to)
      }
    }
    renameSync(LOG, `${LOG}.1`)
  } catch {
  }
}

function findBun() {
  const candidates = [
    process.env.GYC_BUN,
    "C:\\Program Files\\nodejs\\bun.exe",
    join(process.env.USERPROFILE || "", ".bun", "bin", "bun.exe"),
  ].filter(Boolean)
  return candidates.find((c) => existsSync(c)) || "bun"
}

// 读 pm2 进程列表（jlist 输出 JSON 数组）
function pm2Proc(name) {
  const r = spawnSync(findBun(), ["x", "pm2", "jlist"], { encoding: "utf8", timeout: 60000, cwd: ROOT })
  if (r.error || r.status !== 0) return null
  const out = (r.stdout ?? "").trim()
  const start = out.indexOf("[")
  if (start < 0) return null
  try {
    const arr = JSON.parse(out.slice(start))
    return arr.find((p) => p.name === name) ?? null
  } catch {
    return null
  }
}

async function httpOk(path) {
  try {
    const res = await fetch(BASE + path, { signal: AbortSignal.timeout(8000) })
    return res.ok || res.status === 401 // 401 也证明服务存活
  } catch {
    return false
  }
}

async function main() {
  rotateLog()
  const now = Date.now()
  const proc = pm2Proc("gyc-stability")
  const alive = proc ? proc.pm2_env?.status === "online" : false
  // pm2 v7 字段为 restart_time（旧版为 restart_count），取兼容值
  const restarts = proc ? (proc.pm2_env?.restart_time ?? proc.pm2_env?.restart_count ?? -1) : -1
  const uptimeMs = proc ? now - (proc.pm2_env?.pm_uptime ?? now) : 0
  const memMb = proc ? Math.round((proc.monit?.memory ?? 0) / 1024 / 1024) : -1
  const httpUp = alive ? await httpOk("/session?limit=1") : false

  // 重启基线：首次巡检记录当前值作为零点
  let baseline = null
  if (existsSync(STATE)) {
    try {
      baseline = JSON.parse(readFileSync(STATE, "utf8"))
    } catch {
      baseline = null
    }
  }
  if (!baseline) baseline = { baselineRestarts: restarts >= 0 ? restarts : 0, startedAt: now }
  const crashCount = restarts >= 0 ? Math.max(0, restarts - baseline.baselineRestarts) : -1
  writeFileSync(STATE, JSON.stringify(baseline))

  const entry = {
    ts: new Date().toISOString(),
    uptimeHours: +(uptimeMs / 3600000).toFixed(3),
    restarts,
    crashCount,
    alive,
    httpUp,
    memMb,
  }
  appendFileSync(LOG, JSON.stringify(entry) + "\n")

  // 检查点判定：1h/4h/8h/24h
  const marks = [1, 4, 8, 24]
  const hit = marks.find((h) => entry.uptimeHours >= h && !(baseline[`mark${h}h`] === true))
  let verdict = ""
  if (hit && !alive) verdict = `${hit}h 检查点：进程离线 ✗`
  else if (hit && crashCount > 0) verdict = `${hit}h 检查点：发生 ${crashCount} 次重启 ✗`
  else if (hit) {
    verdict = `${hit}h 检查点：Crash=0 通过 ✓`
    baseline[`mark${h}h`] = true
    writeFileSync(STATE, JSON.stringify(baseline))
  }

  console.log(
    `巡检 ${entry.ts} | 存活 ${entry.uptimeHours}h | 重启 ${crashCount} | HTTP ${httpUp ? "up" : "down"} | 内存 ${memMb}MB${verdict ? "\n" + verdict : ""}`,
  )
  process.exit(!alive || !httpUp ? 1 : 0)
}

main().catch((e) => {
  console.error("巡检异常:", e.message)
  process.exit(1)
})
