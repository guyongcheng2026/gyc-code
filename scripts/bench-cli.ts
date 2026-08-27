// scripts/bench-cli.ts — gyc CLI 启动性能基准（行动项 5：性能基准测试）
// 监控回归：每次改动后运行，确认冷启动/惰性加载/dist 体积未劣化。
// 用法：
//   bun scripts/bench-cli.ts [--runs 5] [--version-threshold 3500]
//        [--help-threshold 4000] [--report bench-cli-report.json]
// 说明：
//   - 走 Node 目标 dist（bin/gyc 默认运行时），无 dist 时回退 src 入口。
//   - 冷启动判定上限默认与 AGENTS.md 性能基准一致（--version <3.5s）。
//   - 退出码：任一项 FAIL → 1；PASS/WARN → 0。

import { spawnSync } from "node:child_process"
import { existsSync, readFileSync, statSync, writeFileSync } from "node:fs"
import { join, dirname } from "node:path"
import { fileURLToPath } from "node:url"

const __dirname = dirname(fileURLToPath(import.meta.url))
const ROOT = join(__dirname, "..")
const DIST_ENTRY = join(ROOT, "dist", "index.js")
const SRC_ENTRY = join(ROOT, "src", "gyccode", "index.ts")
const RUNTIME_MARK = join(ROOT, "dist", "RUNTIME")

const argv = process.argv.slice(2)
function argValue(name, fallback) {
  const i = argv.indexOf(name)
  return i >= 0 && argv[i + 1] !== undefined ? argv[i + 1] : fallback
}

const RUNS = Number(argValue("--runs", "5"))
const VERSION_THRESHOLD_MS = Number(argValue("--version-threshold", "3500"))
const HELP_THRESHOLD_MS = Number(argValue("--help-threshold", "4000"))
const REPORT_PATH = argValue("--report", join(ROOT, "bench-cli-report.json"))

const nowMs = () => Number(process.hrtime.bigint() / 1000000n)

// 运行目标：优先 dist（Node 目标），无则回退 src（bun 直接跑）
const useDist = existsSync(DIST_ENTRY)
const runtimeMark = useDist && existsSync(RUNTIME_MARK) ? readFileSync(RUNTIME_MARK, "utf8").trim() : "n/a"
const args0 = useDist ? [DIST_ENTRY] : [SRC_ENTRY]
const bin = useDist ? "node" : "bun"

function runOnce(subargs: string[]): { ms: number; exit: number | null } {
  const t0 = nowMs()
  const r = spawnSync(bin, [...args0, ...subargs], {
    encoding: "utf8",
    timeout: 30_000,
    cwd: ROOT,
    windowsHide: true,
    stdio: ["ignore", "pipe", "pipe"],
  })
  return { ms: nowMs() - t0, exit: r.status }
}

function median(nums: number[]): number {
  const sorted = [...nums].sort((a, b) => a - b)
  const mid = Math.floor(sorted.length / 2)
  return sorted.length % 2 === 0 ? (sorted[mid - 1] + sorted[mid]) / 2 : sorted[mid]
}

const mV = (): number => median(samplesV)
const mH = (): number => median(samplesH)

// 基准组：semver 探测（最小工作负载，近似裸启动）
function versionMin(): number {
  const t0 = nowMs()
  spawnSync(bin, [...args0, "--version"], { encoding: "utf8", timeout: 30_000, cwd: ROOT, windowsHide: true, stdio: ["ignore", "pipe", "pipe"] })
  return nowMs() - t0
}

const samplesV: number[] = []
const samplesH: number[] = []
const warmupsV: number[] = []
const warmupsH: number[] = []

for (let i = 0; i < Math.min(RUNS, 2); i++) warmupsV.push(versionMin())
for (let i = 0; i < Math.min(RUNS, 2); i++) warmupsH.push(runOnce(["--help"]).ms)
for (let i = 0; i < RUNS; i++) samplesV.push(runOnce(["--version"]).ms)
for (let i = 0; i < RUNS; i++) samplesH.push(runOnce(["--help"]).ms)

const distSizeMB = useDist && existsSync(DIST_ENTRY) ? +(statSync(DIST_ENTRY).size / 1024 / 1024).toFixed(2) : 0

const results = {
  runtime: useDist ? `node(dist, mark=${runtimeMark})` : "bun(src)",
  runs: RUNS,
  versionColdMedianMs: Math.round(mV()),
  versionWarmMs: Math.round(median(warmupsV)),
  helpColdMedianMs: Math.round(mH()),
  helpWarmMs: Math.round(median(warmupsH)),
  distSizeMB,
}

const versionOk = mV() <= VERSION_THRESHOLD_MS
const helpOk = mH() <= HELP_THRESHOLD_MS
const distOk = useDist && distSizeMB > 0

console.log("=== gyc CLI 性能基准 ===")
console.log(`目标运行时: ${results.runtime} | 取样 ${RUNS} 次`)
console.log(`[${versionOk ? "PASS" : "FAIL"}] --version 冷启动中位 ${results.versionColdMedianMs}ms（阈值 ≤${VERSION_THRESHOLD_MS}ms）`)
console.log(`[${helpOk ? "PASS" : "FAIL"}] --help   冷启动中位 ${results.helpColdMedianMs}ms（阈值 ≤${HELP_THRESHOLD_MS}ms）`)
console.log(`[${useDist ? "PASS" : "WARN"}] dist 入口: ${useDist ? `${results.distSizeMB}MB` : "未构建（回退 src 基准）"}（样本: warm ${results.versionWarmMs}ms/${results.helpWarmMs}ms）`)

writeFileSync(REPORT_PATH, JSON.stringify({ generatedAt: new Date().toISOString(), ...results, versionOk, helpOk, distOk }, null, 2))
console.log(`报告已写入: ${REPORT_PATH}`)
process.exit(versionOk && helpOk && distOk ? 0 : 1)