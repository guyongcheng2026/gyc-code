// 入口 —— 支持两种模式：
//   bun run src/cli.ts                交互循环（多轮会话）
//   bun run src/cli.ts -p "消息"      单轮非交互（全流程验证用）

import * as path from "node:path"
import * as readline from "node:readline"
import { QueryEngine } from "./engine"
import type { PermissionMode } from "./types"

function parseArgs(argv: string[]): { mode: PermissionMode; print: string | null; cwd: string } {
  let mode: PermissionMode = "default"
  let print: string | null = null
  let cwd = process.cwd()
  const rest: string[] = []
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i] ?? ""
    if (arg === "--permission-mode" || arg === "--pm") {
      const value = argv[++i]
      if (value === "default" || value === "acceptEdits" || value === "bypassPermissions") mode = value
      continue
    }
    if (arg === "-p" || arg === "--print") {
      print = argv[++i] ?? ""
      continue
    }
    if (arg === "--cwd") {
      cwd = path.resolve(argv[++i] ?? process.cwd())
      continue
    }
    rest.push(arg)
  }
  if (print === null && rest.length > 0) print = rest.join(" ")
  return { mode, print, cwd }
}

async function main(): Promise<void> {
  const { mode, print, cwd } = parseArgs(process.argv.slice(2))
  const engine = new QueryEngine({ cwd, mode })
  try {
    if (print !== null) {
      // 单轮非交互模式
      const finalText = await engine.submitMessage(print)
      if (finalText) process.stdout.write(finalText + "\n")
      engine.close()
      return
    }
    // 交互循环
    process.stdout.write("gyc cli 已就绪（Ctrl+C 退出）\n\n")
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout, prompt: "> " })
    rl.prompt()
    rl.on("line", line => {
      const text = line.trim()
      if (!text) {
        rl.prompt()
        return
      }
      if (text === "/exit" || text === "/quit") {
        rl.close()
        return
      }
      // 暂停 readline 交由引擎处理输出，完成后恢复
      rl.pause()
      engine
        .submitMessage(text)
        .then(finalText => {
          if (finalText) process.stdout.write(finalText + "\n")
        })
        .catch(error => {
          process.stdout.write(`错误: ${error instanceof Error ? error.message : String(error)}\n`)
        })
        .finally(() => {
          process.stdout.write(`\n[${engine.usageSummary()}]\n`)
          rl.resume()
          rl.prompt()
        })
    })
    rl.on("close", () => {
      engine.close()
      process.exit(0)
    })
  } catch (error) {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`)
    process.exit(1)
  }
}

void main()
