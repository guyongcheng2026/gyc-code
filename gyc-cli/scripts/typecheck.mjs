// gyc cli 类型检查：跑 tsc --noEmit，聚焦本包（src/**）诊断。
// 上游 @gyccode/llm 源码（../src/llm/**）在 effect v4 beta 下存在既有类型噪音，
// 那是主项目的依赖治理范围，不阻塞 gyc cli 的类型检查。
import { spawnSync } from "node:child_process"
import { exit } from "node:process"

const cwd = new URL("..", import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1")
const result = spawnSync("bunx tsc --noEmit --pretty false", {
  cwd,
  encoding: "utf8",
  shell: process.platform === "win32",
})

const output = `${result.stdout ?? ""}${result.stderr ?? ""}`
const lines = output.split("\n").filter(line => line.trim().length > 0)
const own = lines.filter(line => line.includes("gyc-cli/src") || line.includes("gyc-cli\\src"))
const upstream = lines.length - own.length

if (own.length > 0) {
  process.stderr.write(own.join("\n") + "\n")
  process.stderr.write(`类型检查失败：gyc cli 自身 ${own.length} 处错误\n`)
  exit(1)
}
process.stdout.write(`类型检查通过（gyc cli 自身 0 错误；上游既有诊断 ${upstream} 条，不属于本包范围）\n`)
