// 交互式主循环 - 整合输入、菜单、历史、执行器
// 替代 default.ts 中的 interactiveLoop

import { RawInputHandler, readLine } from "./input"
import { SlashMenu, CommandPalette } from "./menu"
import { IHistoryManager, createHistoryManager } from "./history"
import { Completer } from "./completer"
import { createLocalSdk, fetchDynamicCommands, parseModelInput, resolveFileParts } from "./pipeline"
import { type GyccodeClient } from "@gyccode/protocol/v2"
import { UI } from "../ui"
import { executeBuiltinCommand, ExecutorContext } from "./executor"
import { HistorySearchResult } from "./history"
import { TokyoNight, Typography } from "../theme"

export interface InteractiveOptions {
  directory?: string
  model?: string
  variant?: string
  agent?: string
  thinking?: boolean
  auto?: boolean
  files?: string[]
  sessionId?: string
  continue?: boolean
  fork?: boolean
}

// 输入界面配色：取自"东京夜"主题（对齐 gyc tui）
const CYAN = TokyoNight.primary
const DIM = TokyoNight.textMuted
const RESET = Typography.reset + TokyoNight.text
const BOLD = Typography.bold

export async function runInteractiveLoop(options: InteractiveOptions): Promise<void> {
  const directory = options.directory ?? process.cwd()
  const sdk = await createLocalSdk(directory)

  // 获取动态命令
  const dynamicCommands = await fetchDynamicCommands(sdk, directory)

  // 解析/创建会话
  let sessionId = options.sessionId
  if (!sessionId && options.continue) {
    const list = await sdk.session.list()
    const roots = (list.data ?? []).filter(s => !s.parentID)
    // -c 恢复优先当前目录的根会话；跨目录场景避免错恢复
    const base = roots.find(s => s.directory === directory) ?? roots[0]
    if (base) sessionId = base.id
  }
  if (!sessionId) {
    const created = await sdk.session.create({
      title: undefined,
      agent: options.agent,
      model: options.model ? { providerID: options.model.split("/")[0], id: options.model.split("/").slice(1).join("/"), variant: options.variant } : undefined,
      permission: [
        { permission: "question", action: "deny", pattern: "*" },
        { permission: "plan_enter", action: "deny", pattern: "*" },
        { permission: "plan_exit", action: "deny", pattern: "*" },
      ],
    })
    sessionId = created.data?.id
    if (!sessionId) {
      // 暴露服务端错误明细，避免只显示笼统提示拖慢排障
      UI.error(`创建会话失败: ${created.error ? JSON.stringify(created.error) : "未知错误（无返回数据）"}`)
      process.exit(1)
    }
  }

  // 初始化组件
  const history = await createHistoryManager(sessionId)
  const completer = new Completer({ sdk, directory, sessionId })
  await completer.warmup()

  const executorCtx: ExecutorContext = {
    sdk,
    sessionId,
    directory,
    input: {
      model: options.model,
      variant: options.variant,
      agent: options.agent,
      thinking: options.thinking ?? false,
      auto: options.auto ?? false,
      files: options.files,
    },
    dynamicCommands,
    subagents: [],
    history,
  }

  // 斜杠菜单
  const slashMenu = new SlashMenu({
    onSelect: async (entry) => {
      await handleSlashEntry(executorCtx, entry, slashMenu)
    },
    onCancel: () => {
      slashMenu.hide()
      inputHandler.setValue(inputHandler.getValue().replace(/^\/.*$/, ""))
    },
    onFilterChange: (query) => {
      // 可选：实时预览
    },
    dynamicCommands,
    sessionId,
  })

  // 命令面板
  const commandPalette = new CommandPalette(
    async (entry) => {
      await handleSlashEntry(executorCtx, entry, slashMenu)
    },
    () => { paletteOpen = false },
    dynamicCommands
  )

  // 输入处理器
  let paletteOpen = false
  let paletteSavedBuffer = ""

  const inputHandler = new RawInputHandler(process.stdin, process.stdout, {
    prompt: CYAN + "> " + RESET,
    onSubmit: async (value) => {
      if (paletteOpen) return
      await handleSubmit(executorCtx, value.trim(), slashMenu, history, completer)
      // AI 回复输出完毕，重新渲染 "> " 输入提示行
      inputHandler.redraw()
    },
    onCancel: () => {
      if (paletteOpen) {
        paletteOpen = false
        commandPalette.close()
        inputHandler.setValue(paletteSavedBuffer)
        renderAll()
      } else if (slashMenu.isHidden() === false) {
        slashMenu.hide()
        inputHandler.setValue(inputHandler.getValue().replace(/^\/.*$/, ""))
      } else {
        // Ctrl+C 退出
        process.exit(0)
      }
    },
    onTab: async (value, cursor) => {
      if (paletteOpen) return []
      if (value.startsWith("/")) {
        slashMenu.filter(value.slice(1))
        slashMenu.show()
        renderAll()
        return []
      }
      // 普通补全
      const items = await completer.complete(value, cursor)
      return items.map(i => i.insertText)
    },
    onKeyDown: (key) => {
      if (paletteOpen) {
        if (key.name === "up") { commandPalette.move(-1); renderAll(); return true }
        if (key.name === "down") { commandPalette.move(1); renderAll(); return true }
        if (key.name === "return") { commandPalette.execute(); return true }
        if (key.name === "escape") { paletteOpen = false; commandPalette.close(); inputHandler.setValue(paletteSavedBuffer); renderAll(); return true }
        return false
      }

      if (!slashMenu.isHidden()) {
        if (key.name === "up") { slashMenu.moveSelection(-1); renderAll(); return true }
        if (key.name === "down") { slashMenu.moveSelection(1); renderAll(); return true }
        if (key.name === "return") { slashMenu.executeSelected(); return true }
        if (key.name === "escape") { slashMenu.hide(); inputHandler.setValue(inputHandler.getValue().replace(/^\/.*$/, "")); renderAll(); return true }
        if (key.name === "tab") { return true } // 已在 onTab 处理
        return false
      }

      // Ctrl+P 打开命令面板
      if (key.ctrl && key.name === "p") {
        paletteOpen = true
        paletteSavedBuffer = inputHandler.getValue()
        commandPalette.filter("")
        renderAll()
        return true
      }

      // Ctrl+R 历史搜索
      if (key.ctrl && key.name === "r") {
        handleHistorySearch(executorCtx, history)
        return true
      }

      return false
    },
  })

  // 先渲染欢迎界面，再渲染输入行——保证光标停在 "> " 提示符后（对齐 pi agent）
  await renderWelcome(sdk, sessionId, executorCtx.input)

  await inputHandler.start()

  // 主渲染循环
  function renderAll(): void {
    const buffer = inputHandler.getValue()
    const cursor = inputHandler.getCursor()
    if (paletteOpen) {
      commandPalette.render(process.stdout)
    } else {
      slashMenu.render(process.stdout, buffer, cursor)
    }
  }

  // 保持进程运行：等待退出信号（SIGINT 或 stdin EOF），退出时清理输入处理器
  await new Promise<void>((resolve) => {
    const onExit = () => {
      inputHandler.stop()
      process.off("SIGINT", onExit)
      process.stdin.off("end", onExit)
      resolve()
    }
    process.once("SIGINT", onExit)
    process.stdin.once("end", onExit)
  })
}

async function renderWelcome(sdk: GyccodeClient, sessionId: string, input: ExecutorContext["input"]): Promise<void> {
  let modelID = input.model ?? "default"
  let modelVariant = input.variant
  try {
    const [cfg, session] = await Promise.all([
      sdk.config.get(),
      sdk.session.get({ sessionID: sessionId }).catch(() => undefined),
    ])
    const data = session?.data
    if (data?.model) {
      modelID = data.model.id
      modelVariant = data.model.variant
    } else if (cfg.data?.model) {
      modelID = cfg.data.model
    }
  } catch (e) {
    // 读取配置/会话失败时降级为默认模型，留痕以便排查显示异常
    console.error(`[interactive] 读取当前模型配置失败，已回退默认：${String(e)}`)
  }

  const shortModel = modelID.includes("/") ? modelID.slice(modelID.lastIndexOf("/") + 1) : modelID
  const displayModel = modelVariant && modelVariant !== "default" ? `${shortModel} ${modelVariant}` : shortModel

  const dir = process.cwd()
  const homedir = (await import("os")).homedir()
  const displayDir = dir === homedir ? "~" : dir.startsWith(homedir + "\\") ? "~" + dir.slice(homedir.length) : dir

  console.log(`${CYAN}›${RESET} Ask gyc to do anything`)
  console.log("")
  console.log(`  ${DIM}${displayModel} · ${displayDir}${RESET}`)
  console.log("")
}

async function handleSubmit(
  ctx: ExecutorContext,
  value: string,
  slashMenu: SlashMenu,
  history: IHistoryManager,
  completer: Completer
): Promise<void> {
  if (!value) return

  // 斜杠命令
  if (value.startsWith("/")) {
    const parts = value.slice(1).split(" ", 2)
    const cmd = parts[0]
    const args = parts[1] ?? ""
    await history.addSlashCommand(value)
    const result = await executeBuiltinCommand(ctx, cmd, args)
    if (result === "exit") process.exit(0)
    return
  }

  // 普通消息
  await history.addUserInput(value)

  // 执行一轮对话
  await executeTurn(ctx, value)

  // 刷新动态命令
  ctx.dynamicCommands = await fetchDynamicCommands(ctx.sdk, ctx.directory)
  slashMenu.updateDynamicCommands(ctx.dynamicCommands)
  completer.clearCache()
  await completer.warmup()
}

async function handleSlashEntry(
  ctx: ExecutorContext,
  entry: { fill: string; dynamic: boolean },
  slashMenu: SlashMenu
): Promise<void> {
  const parts = entry.fill.slice(1).split(" ", 2)
  const cmd = parts[0]
  const args = parts[1] ?? ""

  if (entry.dynamic) {
    // 动态命令：通过 session.command 执行
    try {
      const { streamLoop } = await import("../cmd/run/stream-cli")
      // 动态命令轮次同样每轮新建 SSE 订阅：轮次结束（含异常路径）必须 abort，
      // 否则底层连接仅 releaseLock 不 cancel，长驻 REPL 内反复执行动态命令会累积泄漏
      const sseAbort = new AbortController()
      const events = await ctx.sdk.event.subscribe()
      try {
        const completed = streamLoop({
          client: ctx.sdk,
          events,
          sessionID: ctx.sessionId,
          format: "default",
          thinking: ctx.input.thinking,
          auto: ctx.input.auto,
          onSubagent: (info) => {
            ctx.subagents.push({ ...info, at: new Date().toLocaleTimeString() })
            if (ctx.subagents.length > 100) ctx.subagents.splice(0, ctx.subagents.length - 100)
          },
        })
        const result = await ctx.sdk.session.command({ sessionID: ctx.sessionId, command: cmd, arguments: args })
        if (result.error) UI.error(JSON.stringify(result.error))
        await completed
      } finally {
        sseAbort.abort()
      }
    } catch (e) {
      UI.error(String(e))
    }
  } else {
    // 内置命令
    await ctx.history.addSlashCommand("/" + cmd + (args ? " " + args : ""))
    const result = await executeBuiltinCommand(ctx, cmd, args)
    if (result === "exit") process.exit(0)
  }
  slashMenu.hide()
}

async function handleHistorySearch(ctx: ExecutorContext, history: IHistoryManager): Promise<void> {
  const { createInterface } = await import("node:readline/promises")
  const rl = createInterface({ input: process.stdin, output: process.stdout })

  console.log("\n" + CYAN + "(reverse-i-search)" + RESET + "`" + ": ")

  let query = ""
  let results: HistorySearchResult[] = []
  let selected = 0

  const render = () => {
    process.stdout.write("\r\x1b[K" + CYAN + "(reverse-i-search)" + RESET + "`" + query + "`: ")
    if (results.length > 0) {
      const entry = results[selected]
      const time = new Date(entry.entry.timestamp).toLocaleTimeString()
      process.stdout.write(`${DIM}[${time}]${RESET} ${entry.entry.text}`)
    }
  }

  return new Promise((resolve) => {
    const finish = (selectedEntry?: string) => {
      rl.close()
      process.stdin.setRawMode(false)
      process.stdin.pause()
      process.stdout.write("\n")
      if (selectedEntry) {
        // 将选中的历史条目填入输入行
        // 这里需要访问 inputHandler，简化处理
      }
      resolve()
    }

    process.stdin.setRawMode(true)
    process.stdin.resume()
    process.stdin.on("data", (chunk: Buffer) => {
      const str = chunk.toString("utf8")
      for (const char of str) {
        const code = char.charCodeAt(0)
        if (code === 3) { finish(); return } // Ctrl+C
        if (code === 18) { // Ctrl+R - 下一个匹配
          selected = (selected + 1) % results.length
          render()
          return
        }
        if (code === 13 || code === 10) { // Enter
          if (results[selected]) finish(results[selected].entry.text)
          else finish()
          return
        }
        if (code === 27) { finish(); return } // Escape
        if (code === 127 || code === 8) { // Backspace
          query = query.slice(0, -1)
          history.search(query, 10).then(r => { results = r; selected = 0; render() })
          return
        }
        if (code >= 32) {
          query += char
          history.search(query, 10).then(r => { results = r; selected = 0; render() })
        }
      }
    })
    render()
  })
}

async function executeTurn(ctx: ExecutorContext, text: string): Promise<void> {
  const { resolveFileParts } = await import("./pipeline")
  const { streamLoop } = await import("../cmd/run/stream-cli")

  const fileParts = await resolveFileParts(ctx.input.files ?? [], ctx.directory, { skipMissing: true })
  // REPL 每轮新建 SSE 订阅：轮次结束必须 abort，否则底层连接仅 releaseLock 不关闭
  const sseAbort = new AbortController()
  const events = await ctx.sdk.event.subscribe()
  try {
    await runStreamTurn(ctx, text, { streamLoop, events, sseAbort, fileParts })
  } finally {
    sseAbort.abort()
  }
}

async function runStreamTurn(
  ctx: ExecutorContext,
  text: string,
  deps: {
    streamLoop: typeof import("../cmd/run/stream-cli")["streamLoop"]
    events: Awaited<ReturnType<ExecutorContext["sdk"]["event"]["subscribe"]>>
    sseAbort: AbortController
    fileParts: Awaited<ReturnType<typeof resolveFileParts>>
  },
): Promise<void> {
  const { fileParts, streamLoop, events } = deps
  const completed = streamLoop({
    client: ctx.sdk,
    events,
    sessionID: ctx.sessionId,
    format: "default",
    thinking: ctx.input.thinking,
    auto: ctx.input.auto,
    interactive: {
      askPermission: async (permission) => {
        UI.println(UI.Style.TEXT_WARNING_BOLD + "!", UI.Style.TEXT_NORMAL + `permission requested: ${permission.permission} (${permission.patterns.join(", ")})${permission.subagent ? " [subagent]" : ""}`)
        UI.println("  [y] 允许一次  [a] 始终允许  [n/Enter] 拒绝")
        for (;;) {
          const line = (await readLine("  > ")).trim().toLowerCase()
          if (line === "y") return "once"
          if (line === "a") return "always"
          if (line === "n" || line === "" || line === "q") return "reject"
        }
      },
      askQuestion: async (request) => {
        request.questions.forEach((question, index) => {
          console.log(`  Q${index + 1}: ${question.question}`)
          question.options.forEach((option, j) => console.log(`    [${j + 1}] ${option.label}${option.description ? " — " + option.description : ""}`))
          if (question.custom !== false) console.log("    [0] 自定义答案")
        })
        const line = await readLine("  回答（每问用 | 分隔，多选用逗号）: ")
        const parts = line.split("|")
        return request.questions.map((question, index) => {
          const raw = (parts[index] ?? "").trim()
          if (!raw) return []
          return raw.split(",").map(item => item.trim()).filter(Boolean).map(item => {
            const num = Number(item)
            if (Number.isInteger(num) && num >= 1 && num <= question.options.length) return question.options[num - 1]!.label
            return item
          })
        })
      },
    },
    onSubagent: (info) => {
      ctx.subagents.push({ ...info, at: new Date().toLocaleTimeString() })
      if (ctx.subagents.length > 100) ctx.subagents.splice(0, ctx.subagents.length - 100)
    },
  })

  const model = parseModelInput(ctx.input.model)
  const result = await ctx.sdk.session.prompt({
    sessionID: ctx.sessionId,
    model: model ? { providerID: model.providerID, modelID: model.modelID } : undefined,
    agent: ctx.input.agent,
    parts: [...fileParts, { type: "text" as const, text }],
  })
  if (result.error) { UI.error(JSON.stringify(result.error)); return }
  await completed
}


