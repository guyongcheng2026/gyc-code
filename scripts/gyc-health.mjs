// gyc-health：仓库健康快照（只读、不阻塞退出码）。
//
// 铁律：所有数字必须现场实测。写死数值等于自欺——趋势变化会被完全掩盖，
// 反而制造「健康」的假象（谷总最在意的幻觉率红线）。
//
// 用法：
//   node scripts/gyc-health.mjs            # 快速：静态计数
//   node scripts/gyc-health.mjs --tests    # 附加：全量 bun test（较慢）
import { execSync } from "node:child_process"

function run(cmd) {
  try {
    return execSync(cmd, { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"], maxBuffer: 64 * 1024 * 1024 })
  } catch (error) {
    return `${error.stdout ?? ""}${error.stderr ?? ""}`
  }
}

function countMatches(pattern) {
  const out = run(`rg -o --no-filename "${pattern}" src --glob "*.ts" --glob "*.tsx"`)
  return out.split("\n").filter(Boolean).length
}

// 口径统一为：src 下 *.ts/*.tsx 的「匹配出现次数」（非行数、非文件数）。
// 任一口径变更必须在此注明，否则历史数字失去可比性——口径漂移比绝对值更危险。
//   any          = 类型注解 `: any` + 断言 `as any`（历史基线 165 的近似口径）
//   console.log  = 调用点 `console.log(`
//   TODO/FIXME   = 两类标记出现次数合计
console.log("[gyc-health] Health check started")
console.log(`[gyc-health] any count: ${countMatches(":\\s*any\\b") + countMatches("as any\\b")}`)
console.log(`[gyc-health] console.log count: ${countMatches("console\\.log\\(")}`)
console.log(`[gyc-health] TODO/FIXME count: ${countMatches("TODO|FIXME")}`)

if (process.argv.includes("--tests")) {
  const out = run("bun test")
  const pass = /(\d+)\s+pass/.exec(out)?.[1] ?? "?"
  const fail = /(\d+)\s+fail/.exec(out)?.[1] ?? "?"
  console.log(`[gyc-health] tests: ${pass} pass, ${fail} fail`)
}

console.log("[gyc-health] Check completed (status only, no blocking)")
