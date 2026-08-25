// 复刻守护内 runTask 的 spawn 调用，诊断挂起原因
import { spawn } from "node:child_process"

console.log("[diag] execPath:", process.execPath)
const started = Date.now()
const child = spawn(
  process.execPath,
  [
    "--preload",
    "./scripts/bun-solid-preload.ts",
    "--conditions=browser",
    "./src/gyccode/index.ts",
    "run",
    "一句话回答package.json的name字段值",
    "--yolo",
  ],
  {
    cwd: "C:\\gyc-code",
    windowsHide: true,
    timeout: 10 * 60_000,
    stdio: ["ignore", "pipe", "pipe"],
  },
)
console.log("[diag] child pid:", child.pid)

let stdout = ""
let stderr = ""
child.stdout?.on("data", (chunk: Buffer) => (stdout += chunk.toString("utf-8")))
child.stderr?.on("data", (chunk: Buffer) => (stderr += chunk.toString("utf-8")))
child.on("error", (err) => console.log("[diag] error event:", String(err)))
child.on("close", (code) => {
  console.log(`[diag] closed code=${code} elapsed=${Math.round((Date.now() - started) / 1000)}s`)
  console.log("[diag] stdout tail:", JSON.stringify(stdout.slice(-200)))
  console.log("[diag] stderr tail:", JSON.stringify(stderr.slice(-200)))
  process.exit(0)
})
setTimeout(() => {
  console.log(`[diag] STILL PENDING after ${Math.round((Date.now() - started) / 1000)}s; stdout len=${stdout.length} stderr len=${stderr.length}`)
  child.kill()
  setTimeout(() => process.exit(1), 3000)
}, 90_000)
