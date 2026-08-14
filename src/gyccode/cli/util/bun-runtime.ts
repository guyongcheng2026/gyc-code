// Bun 运行时定位与子进程拉起（TUI/mini 的 OpenTUI 原生渲染仅支持 Bun）。
// Node 主进程无法直接初始化 TUI，需要找到 bun 可执行文件并运行 Bun 目标产物
// （dist-bun）接管全屏交互；非交互命令保持 Node 运行。
//
// 打包后本模块位于 dist/ 根（chunk-*.js 或 util/*.js），dist-bun 与 dist 同级，
// 因此从 import.meta.url 向上逐级查找 dist-bun/index.js，兼容多种产物布局。
import { existsSync } from "fs"
import { spawnSync } from "child_process"
import { dirname, join } from "path"
import { fileURLToPath } from "url"

export type BunRuntime = {
  bun: string
  distBun: string
}

function findDistBun(start: string): string | undefined {
  let here = start
  for (let i = 0; i < 4; i++) {
    const candidate = join(here, "dist-bun", "index.js")
    if (existsSync(candidate)) return candidate
    const parent = dirname(here)
    if (parent === here) break
    here = parent
  }
  return undefined
}

export function resolveBunRuntime(): BunRuntime | undefined {
  const start = dirname(fileURLToPath(import.meta.url))
  const distBun = findDistBun(start)
  if (!distBun) return undefined
  const candidates = [
    process.env.GYC_BUN,
    join(process.env.USERPROFILE ?? "", ".bun", "bin", "bun.exe"),
    join(process.env.ProgramFiles ?? "C:\\Program Files", "nodejs", "bun.exe"),
  ].filter((c): c is string => Boolean(c))
  const bun = candidates.find((c) => existsSync(c)) ?? "bun"
  return { bun, distBun }
}

// 同步运行 Bun 目标产物（继承当前终端，独占全屏），返回子进程退出码；
// dist-bun 缺失时返回 undefined。
export function spawnBunSync(args: string[]): number | undefined {
  const runtime = resolveBunRuntime()
  if (!runtime) return undefined
  const result = spawnSync(runtime.bun, [runtime.distBun, ...args], { stdio: "inherit" })
  if (result.error) return undefined
  return result.status ?? 0
}
