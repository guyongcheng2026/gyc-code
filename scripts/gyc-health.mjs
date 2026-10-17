// gyc-health：仓库健康快照（只读、不阻塞退出码）。
//
// 铁律：所有数字必须现场实测。写死数值等于自欺——趋势变化会被完全掩盖，
// 反而制造「健康」的假象（谷总最在意的幻觉率红线）。
//
// 用法：
//   node scripts/gyc-health.mjs            # 快速：静态计数
//   node scripts/gyc-health.mjs --tests    # 附加：全量 bun test（较慢）
import { execSync, spawnSync } from "node:child_process"

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
  // 用 spawnSync 直连而非 execSync（经 cmd.exe）：2026-10-16 实测 execSync 链路下
  // bun test 只回显版本头 28 字节（pass 行丢失），同参数 spawnSync 完整可解析。
  // 内联 package.json test script 的等价参数：裸 `bun test` 会带进 src/webapp 组件
  // 测试（其环境由 vitest 提供，bun 下必失败，实测 20 fail），必须带官方排除参数，
  // 与 bun run test 保持同一口径，历史数字才可比。
  const tests = spawnSync(
    "bun",
    ["test", "--preload", "./scripts/bun-solid-preload.ts", "--path-ignore-patterns=src/webapp"],
    { encoding: "utf8", timeout: 900_000, maxBuffer: 64 * 1024 * 1024 },
  )
  const out = `${tests.stdout ?? ""}${tests.stderr ?? ""}`
  const pass = /(\d+)\s+pass/.exec(out)?.[1] ?? "?"
  const fail = /(\d+)\s+fail/.exec(out)?.[1] ?? "?"
  console.log(`[gyc-health] tests: ${pass} pass, ${fail} fail`)

  // 基准集成冒烟显式通道：GYC_BENCHMARK_SMOKE=1 启用 benchmark.test.ts 中 3 个
  // 默认 skip 的集成用例（CLI 启动/模型列表/Provider 加载）。spawn 传 env，
  // Windows 下 spawnSync("bun", ...) 走 .bin 垫片，不依赖 shell 解析。
  console.log("[gyc-health] benchmark smoke: running 3 integration cases...")
  const smoke = spawnSync("bun", ["test", "src/gyccode/benchmark/benchmark.test.ts"], {
    env: { ...process.env, GYC_BENCHMARK_SMOKE: "1" },
    stdio: ["ignore", "pipe", "pipe"],
    encoding: "utf8",
    timeout: 300_000,
    maxBuffer: 64 * 1024 * 1024,
  })
  const smokeOut = `${smoke.stdout ?? ""}${smoke.stderr ?? ""}`
  const smokePass = /(\d+)\s+pass/.exec(smokeOut)?.[1] ?? "?"
  const smokeFail = /(\d+)\s+fail/.exec(smokeOut)?.[1] ?? "?"
  const smokeSkip = /(\d+)\s+skip/.exec(smokeOut)?.[1] ?? "0"
  console.log(`[gyc-health] benchmark smoke: ${smokePass} pass, ${smokeFail} fail, ${smokeSkip} skip`)
}

console.log("[gyc-health] Check completed (status only, no blocking)")
