// gyc cli 入口 —— 支持两种模式：
//   bun run src/cli.ts                交互循环（光标紧贴 > 提示符，输入 / 唤起命令菜单）
//   bun run src/cli.ts -p "消息"      单轮非交互（全流程验证用）
//   bun run src/cli.ts --pm bypassPermissions -p "..."  单轮并跳过权限确认

import * as path from "node:path"
import { QueryEngine } from "./engine"
import { RawInputHandler } from "./input"
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

// ---------------------------------------------------------------------------
// 斜杠命令集（输入 / 唤起菜单，↑↓ 选择，Tab 补全，Enter 执行）
// ---------------------------------------------------------------------------

type SlashCommand = {
  readonly name: string
  readonly description: string
  readonly run: (engine: QueryEngine) => void | Promise<void>
}

const SLASH_COMMANDS: readonly SlashCommand[] = [
  {
    name: "help",
    description: "显示全部命令",
    run: () => printHelp(),
  },
  {
    name: "clear",
    description: "清空会话上下文，开始新对话",
    run: engine => {
      engine.clear()
      process.stdout.write("会话上下文已清空\n")
    },
  },
  {
    name: "model",
    description: "显示当前模型",
    run: engine => {
      process.stdout.write(`当前模型: ${engine.modelInfo()}\n`)
    },
  },
  {
    name: "usage",
    description: "显示本次会话累计 token 用量",
    run: engine => {
      process.stdout.write(`[${engine.usageSummary()}]\n`)
    },
  },
  {
    name: "exit",
    description: "退出 gyc cli",
    run: () => process.exit(0),
  },
]

function printHelp(): void {
  const out = process.stdout
  out.write("可用命令：\n")
  for (const cmd of SLASH_COMMANDS) {
    out.write(`  /${cmd.name.padEnd(8)}${cmd.description}\n`)
  }
}

// ---------------------------------------------------------------------------
// 交互主循环：自绘输入行（光标紧贴提示符）+ 斜杠命令菜单
// ---------------------------------------------------------------------------

function runInteractive(cwd: string, mode: PermissionMode): void {
  const out = process.stdout
  out.write("gyc cli 已就绪（Ctrl+C 退出，/help 查看命令）\n\n")

  const engine = new QueryEngine({ cwd, mode })
  let items: SlashCommand[] = []
  let selected = 0
  let menuOpen = false
  // 防递归守卫：菜单刷新触发输入行重绘会再次回调 onChange，内容相同直接跳过
  let lastHandled = "\u0000"

  const input = new RawInputHandler(process.stdin, out, {
    prompt: "> ",
    onSubmit: value => void handleSubmit(value),
    onCancel: () => {
      if (menuOpen) clearBelow()
      else process.exit(0)
    },
    onChange: text => {
      if (text === lastHandled) return
      lastHandled = text
      if (text.startsWith("/")) refreshMenu(text)
      else clearBelow()
    },
    onArrow: direction => {
      if (!menuOpen || items.length === 0) return false
      const delta = direction === "up" ? -1 : 1
      selected = (selected + delta + items.length) % items.length
      paintMenu()
      return true
    },
    onTab: () => {
      const picked = menuOpen ? items[selected] : undefined
      if (picked) input.setValue(`/${picked.name} `)
    },
  })

  /** 按输入前缀过滤命令并绘制菜单（输入行下方） */
  function refreshMenu(text: string): void {
    const query = text.slice(1).toLowerCase()
    items = SLASH_COMMANDS.filter(cmd => cmd.name.startsWith(query)).slice()
    if (selected >= items.length) selected = 0
    menuOpen = items.length > 0
    paintMenu()
  }

  /** 重绘菜单列表后把光标移回输入行（紧贴提示符） */
  function paintMenu(): void {
    out.write("\r\x1b[J")
    if (menuOpen) {
      for (const [index, cmd] of items.entries()) {
        const mark = index === selected ? "›" : " "
        out.write(`\n  ${mark} /${cmd.name.padEnd(9)}${cmd.description}`)
      }
      out.write(`\x1b[${items.length}A\r`)
    }
    input.redraw()
  }

  /** 关闭菜单并清空输入行下方区域 */
  function clearBelow(): void {
    menuOpen = false
    items = []
    out.write("\r\x1b[J")
    input.redraw()
  }

  async function handleSubmit(value: string): Promise<void> {
    // 菜单选中：执行命令（Enter 在菜单可见时优先选中当前高亮项）
    const picked = menuOpen ? items[selected] : undefined
    if (picked) {
      await picked.run(engine)
      input.redraw()
      return
    }
    if (value.startsWith("/")) {
      const text = value.trim()
      const cmd = SLASH_COMMANDS.find(c => `/${c.name}` === text)
      if (cmd) await cmd.run(engine)
      else out.write(`未知命令 ${text}（/help 查看全部命令）\n`)
      input.redraw()
      return
    }
    if (!value.trim()) return
    input.addToHistory(value)
    // 暂停输入处理器（退出 raw mode），交由引擎输出与权限确认，完成后恢复
    await input.stop()
    try {
      await engine.submitMessage(value)
    } finally {
      await input.start()
    }
  }

  void input.start()
}

async function main(): Promise<void> {
  const { mode, print, cwd } = parseArgs(process.argv.slice(2))
  try {
    if (print !== null) {
      // 单轮非交互模式（最终文本由本入口统一输出，引擎内不重复打印）
      const engine = new QueryEngine({ cwd, mode })
      const finalText = await engine.submitMessage(print, { emitText: false })
      if (finalText) process.stdout.write(finalText + "\n")
      return
    }
    runInteractive(cwd, mode)
  } catch (error) {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`)
    process.exit(1)
  }
}

void main()
