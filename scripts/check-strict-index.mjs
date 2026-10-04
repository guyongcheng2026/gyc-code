#!/usr/bin/env node
// scripts/check-strict-index.mjs
//
// noUncheckedIndexedAccess 恶化门禁（ratchet）。
//
// 背景：全仓 noUncheckedIndexedAccess 已清零（基线 0），本门禁防止新代码重新引入
// 同类错误；实测数只许降不许升（有意调整时才用 --update 重写基线）。
// 本脚本实测当前错误数，与基线比较：只允许下降、禁止上升。
//
// 用法：
//   node scripts/check-strict-index.mjs            # 超基线则 exit 1
//   node scripts/check-strict-index.mjs --update   # 用实测值重写基线（仅在有意收窄时用）
//
// 基线写在同目录 BASELINE 里（单个整数），修改它等价于接受新的债务上限。
import { spawnSync } from "node:child_process"
import fs from "node:fs"
import path from "node:path"
import { fileURLToPath } from "node:url"

const here = path.dirname(fileURLToPath(import.meta.url))
const baselineFile = path.join(here, "strict-index-baseline.txt")

const run = () => {
  const proc = spawnSync(
    process.execPath,
    [path.join(here, "..", "node_modules", "typescript", "bin", "tsc"), "--noEmit", "--noUncheckedIndexedAccess"],
    { encoding: "utf8", maxBuffer: 64 * 1024 * 1024 },
  )
  // tsc 有错误时非零退出是预期的；这里只要统计行数
  // 但 proc.error（tsc 根本没能启动：找不到文件/OOM 被杀/超时）必须与「0 个错误」区分开：
  // 此前两者都算出 measured=0，脚本静默 exit 0，基线比对等于没跑。
  if (proc.error) throw proc.error
  const out = `${proc.stdout ?? ""}${proc.stderr ?? ""}`
  return out.split(/\r?\n/).filter((line) => /error TS\d+/.test(line)).length
}

const measured = run()

if (process.argv.includes("--update")) {
  fs.writeFileSync(baselineFile, `${measured}\n`, "utf8")
  console.log(`[strict-index] baseline updated -> ${measured}`)
  process.exit(0)
}

let baseline
try {
  baseline = Number.parseInt(fs.readFileSync(baselineFile, "utf8").trim(), 10)
} catch {
  console.error(`[strict-index] missing baseline file: ${baselineFile}`)
  console.error(`[strict-index] run: node scripts/check-strict-index.mjs --update`)
  process.exit(1)
}

if (!Number.isFinite(baseline)) {
  console.error(`[strict-index] invalid baseline in ${baselineFile}`)
  process.exit(1)
}

console.log(`[strict-index] measured=${measured} baseline=${baseline}`)

if (measured > baseline) {
  console.error(
    `[strict-index] REGRESSION: noUncheckedIndexedAccess errors rose from ${baseline} to ${measured}.\n` +
      `[strict-index] Fix the new errors in the touched files (do NOT bump the baseline for regressions).`,
  )
  process.exit(1)
}

console.log(`[strict-index] OK (non-increasing; ${baseline - measured} cleared vs baseline)`)
