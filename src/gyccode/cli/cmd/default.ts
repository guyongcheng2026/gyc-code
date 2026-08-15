// 纯 CLI 默认入口（gyc / gyc "消息"）。
//
// 三种形态：
//   1. 传消息或 stdin 管道 → 非交互单轮（复用 RunCommand.handler，行为与 `gyc run` 完全一致）。
//   2. 无参数且 stdout 为 TTY → 逐行对话（node:readline，Node 直跑，不依赖 OpenTUI）。
//   3. --mini → 转发 TUI 的 mini 交互（需 Bun，Node 下由 index.ts 先提升）。
import path from "path"
import type { Argv } from "yargs"
import { Effect } from "effect"
import { UI } from "../ui"
import { effectCmd } from "../effect-cmd"
import { readStdin } from "../../../core/util/read-stdin"
import { spawnBunSync } from "../util/bun-runtime"
import { Filesystem } from "@/util/filesystem"
import { createGyccodeClient, type GyccodeClient } from "@gyccode/protocol/v2"
import { FormatError, FormatUnknownError } from "../error"
import { streamLoop } from "./run/stream-cli"
import { InstallationVersion } from "@gyccode/core/installation/version"
import type { PermissionV1 } from "@gyccode/core/v1/permission"
import { RunCommand } from "./run"
import { watchTerminalClose } from "@gyccode/tui/terminal-win32"

function formatRunError(error: unknown) {
  return FormatError(error) ?? FormatUnknownError(error)
}

// 交互模式下用户在场，但第一版无授权 UI，权限保持与 `gyc run` 相同的拒绝规则
// （permission.asked 事件由 streamLoop 打印提示并自动拒绝，安全默认）。
const INTERACTIVE_PERMISSIONS: PermissionV1.Ruleset = [
  { permission: "question", action: "deny", pattern: "*" },
  { permission: "plan_enter", action: "deny", pattern: "*" },
  { permission: "plan_exit", action: "deny", pattern: "*" },
]

type CliInput = {
  directory?: string
  model?: string
  variant?: string
  agent?: string
  thinking: boolean
  auto: boolean
}

function parseModelInput(value: string | undefined): { providerID: string; modelID: string } | undefined {
  if (!value) return undefined
  const [providerID, ...rest] = value.split("/")
  return { providerID, modelID: rest.join("/") }
}

function localFetchFn() {
  return (async (input: RequestInfo | URL, init?: RequestInit) => {
    const { Server } = await import("@/server/server")
    const { ServerAuth } = await import("@/server/auth")
    const request = new Request(input, init)
    const headers = new Headers(request.headers)
    const auth = ServerAuth.header()
    if (auth) headers.set("Authorization", auth)
    return Server.Default().app.fetch(new Request(request, { headers }))
  }) as typeof globalThis.fetch
}

async function createLocalClient(directory: string): Promise<GyccodeClient> {
  return createGyccodeClient({
    baseUrl: "http://gyccode.internal",
    fetch: localFetchFn(),
    directory,
  })
}

// 一轮对话：订阅事件流 → prompt → 流式渲染直到 idle。
async function runTurn(sdk: GyccodeClient, sessionID: string, text: string, input: CliInput) {
  const events = await sdk.event.subscribe()
  const completed = streamLoop({
    client: sdk,
    events,
    sessionID,
    format: "default",
    thinking: input.thinking,
    auto: input.auto,
  })
  const result = await sdk.session.prompt({
    sessionID,
    model: parseModelInput(input.model),
    variant: input.variant,
    parts: [{ type: "text", text }],
  })
  if (result.error) {
    UI.error(formatRunError(result.error))
    return
  }
  // streamLoop 已负责把会话错误（如限流/认证失败）渲染到 UI，并在收到
  // session.error 后提前结束事件消费；这里只需等待其完成即可恢复正常提示符。
  await completed
}

// 渲染启动欢迎界面：复刻 OpenAI Codex 的圆角边框盒子布局。
// ┌ 顶部标题行：>_ GYC CODE (版本)          ┐
// │ model:     <model>      /model to change │
// │ directory: <dir>                        │
// └ 底部圆角边框                             ┘
async function renderWelcome(sdk: GyccodeClient, sessionID: string, input: CliInput) {
  let modelLabel = input.model ?? "default"
  try {
    const [cfg, session] = await Promise.all([
      sdk.config.get(),
      sdk.session.get({ sessionID }).catch(() => undefined),
    ])
    // 会话显式模型优先；否则回退到配置默认模型（实际生效的模型）。
    const data = session?.data
    if (data?.model) {
      modelLabel = data.model.id.includes("/")
        ? data.model.id
        : `${data.model.providerID}/${data.model.id}${data.model.variant && data.model.variant !== "default" ? ` (${data.model.variant})` : ""}`
    } else if (cfg.data?.model) {
      modelLabel = cfg.data.model
    }
  } catch {
    // 读取失败不影响启动，使用默认值。
  }

  const dir = input.directory ?? process.cwd()
  // 归一化 home 目录为 ~，对齐 Codex 的 directory 展示。
  const homedir = (await import("os")).homedir()
  const displayDir = dir === homedir ? "~" : dir.startsWith(homedir + "\\") ? "~" + dir.slice(homedir.length) : dir

  const CYAN = "\x1b[96m"
  const DIM = "\x1b[90m"
  const BOLD = "\x1b[1m"
  const RESET = "\x1b[0m"

  // 内容行（不含左右边框和边距）。宽度以最长行动态计算，避免 model 行溢出。
  const rows = [
    ` ${CYAN}>_${RESET} ${BOLD}GYC CODE${RESET} ${DIM}(${InstallationVersion})${RESET}`,
    " ",
    ` ${DIM}model:${RESET}     ${modelLabel}   ${DIM}/model to change${RESET}`,
    ` ${DIM}directory:${RESET} ${displayDir}`,
  ]
  const inner = Math.max(...rows.map((row) => row.replace(/\x1b\[[0-9;]*m/g, "").length))
  const content = (text: string) => {
    const visible = text.replace(/\x1b\[[0-9;]*m/g, "").length
    return "│ " + text + " ".repeat(inner - visible) + " │"
  }

  const box: string[] = []
  box.push("╭" + "─".repeat(inner + 4) + "╮")
  for (const row of rows) box.push(content(row))
  box.push("╰" + "─".repeat(inner + 4) + "╯")

  const lines: string[] = []
  lines.push(...box)
  lines.push("")
  lines.push(`  ${DIM}Tip:${RESET} 直接输入问题开始对话，输入 ${CYAN}/help${RESET} 查看命令`)
  lines.push("")
  process.stdout.write(lines.join("\n") + "\n")
}

// 渲染底部状态行（Codex 风格）：model · directory，dim 灰色。
async function renderStatusLine(sdk: GyccodeClient, sessionID: string, input: CliInput) {
  let modelLabel = input.model ?? "default"
  try {
    const [cfg, session] = await Promise.all([
      sdk.config.get(),
      sdk.session.get({ sessionID }).catch(() => undefined),
    ])
    const data = session?.data
    if (data?.model) {
      modelLabel = data.model.id.includes("/")
        ? data.model.id
        : `${data.model.providerID}/${data.model.id}`
    } else if (cfg.data?.model) {
      modelLabel = cfg.data.model
    }
  } catch {
    // 忽略读取失败。
  }
  const dir = input.directory ?? process.cwd()
  const homedir = (await import("os")).homedir()
  const displayDir = dir === homedir ? "~" : dir.startsWith(homedir + "\\") ? "~" + dir.slice(homedir.length) : dir
  process.stdout.write(`\n\x1b[90m${modelLabel} · ${displayDir}\x1b[0m\n`)
}

// 通用 CLI 列表选择器（Codex/Claude Code 风格）：
// 显示标题 + 编号列表，↑/↓ 或 输入编号 选择，回车确认，Esc/Ctrl-C 取消。
// 返回选中项的 value；取消返回 undefined。
type ListChoice = { label: string; value: string }
function selectFromList(title: string, items: ListChoice[]): Promise<string | undefined> {
  return new Promise((resolve) => {
    if (items.length === 0) {
      resolve(undefined)
      return
    }
    let index = 0
    const CYAN = "\x1b[96m"
    const DIM = "\x1b[90m"
    const RESET = "\x1b[0m"
    const input = process.stdin
    const render = () => {
      process.stdout.write("\r\x1b[K" + CYAN + "?" + RESET + " " + title + "\n")
      items.forEach((item, i) => {
        const marker = i === index ? CYAN + "›" + RESET : " "
        const num = String(i + 1).padStart(2, " ")
        process.stdout.write(`\x1b[K  ${marker} ${DIM}${num}${RESET}  ${item.label}\n`)
      })
      process.stdout.write(`\x1b[K  输入编号或 ↑/↓ 选择，Enter 确认，Esc 取消\n`)
      process.stdout.write("\x1b[" + (items.length + 1) + "A")
    }
    const finish = (value: string | undefined) => {
      input.removeAllListeners("data")
      input.setRawMode(false)
      input.pause()
      resolve(value)
    }
    input.setRawMode(true)
    input.resume()
    input.on("data", (chunk) => {
      const bytes = typeof chunk === "string" ? Buffer.from(chunk, "utf8") : chunk
      const str = bytes.toString("utf8")
      if (str === "\x1b[A" || str === "\x1bOA") {
        index = (index - 1 + items.length) % items.length
        render()
        return
      }
      if (str === "\x1b[B" || str === "\x1bOB") {
        index = (index + 1) % items.length
        render()
        return
      }
      if (str.startsWith("\x1b")) {
        finish(undefined)
        return
      }
      for (const byte of bytes) {
        const ch = byte as number
        if (ch === 3) {
          finish(undefined)
          return
        } else if (ch === 13 || ch === 10) {
          finish(items[index]?.value)
          return
        } else if (ch >= 48 && ch <= 57) {
          const n = ch - 48
          if (n >= 1 && n <= items.length) {
            index = n - 1
            render()
          }
        }
      }
    })
    render()
  })
}

// 运行斜杠命令。返回 true 表示需要继续（或已退出），由调用方决定是否继续循环。
// 返回 "exit" 表示应退出交互循环。
async function runSlashCommand(
  sdk: GyccodeClient,
  sessionID: string,
  command: string,
  args: string,
  input: CliInput,
): Promise<"continue" | "exit"> {
  switch (command) {
    case "exit":
    case "quit":
      return "exit"
    case "help":
      process.stdout.write(HELP_TEXT + "\n")
      return "continue"
    case "clear":
    case "new": {
      // 开启全新会话：创建新会话并重建 sessionID（模拟 Claude Code 的 /clear）。
      const created = await sdk.session.create({
        title: undefined,
        agent: input.agent,
        permission: [...INTERACTIVE_PERMISSIONS],
      })
      const nextID = created.data?.id
      if (!nextID) {
        UI.error("Failed to create new session")
        return "continue"
      }
      // 更新当前循环的 sessionID（通过可变引用）。
      currentSessionId = nextID
      await renderWelcome(sdk, nextID, input)
      return "continue"
    }
    case "compact": {
      try {
        const result = await sdk.v2.session.compact({ sessionID })
        if (result.error) {
          UI.error(formatRunError(result.error))
        } else {
          process.stdout.write("会话上下文已压缩。\n")
        }
      } catch (e) {
        UI.error(formatRunError(e))
      }
      return "continue"
    }
    case "model": {
      if (!args.trim()) {
        // 无参数：弹出可用模型列表供选择（Claude Code /model 交互）。
        try {
          const [cfg, session] = await Promise.all([
            sdk.config.get(),
            sdk.session.get({ sessionID }).catch(() => undefined),
          ])
          const current = session?.data?.model
            ? `${session.data.model.providerID}/${session.data.model.id}`
            : (cfg.data?.model ?? "default")
          const listRes = await sdk.v2.model.list()
          const models = (listRes.data?.data ?? []).filter(
            (m) => m.enabled !== false && m.capabilities?.tools === true,
          )
          const choices: ListChoice[] = models.map((m) => ({
            label: `${m.providerID}/${m.id}${m.name ? ` (${m.name})` : ""}${`${m.providerID}/${m.id}` === current ? "  ✓" : ""}`,
            value: `${m.providerID}/${m.id}`,
          }))
          if (choices.length === 0) {
            process.stdout.write(`当前模型: ${current}\n（无可用模型列表）\n`)
            return "continue"
          }
          // 列表可能很长：只显示前 80 个，避免终端刷屏。
          const shown = choices.length > 80 ? choices.slice(0, 80) : choices
          process.stdout.write(`当前模型: ${current}\n`)
          const chosen = await selectFromList(
            `选择模型（共 ${choices.length} 个，显示前 ${shown.length} 个；↑/↓ 或输入编号，Enter 确认）`,
            shown,
          )
          if (!chosen) {
            process.stdout.write("已取消。\n")
            return "continue"
          }
          const parsed = parseModelInput(chosen)
          if (!parsed) return "continue"
          const result = await sdk.v2.session.switchModel({
            sessionID,
            model: { providerID: parsed.providerID, id: parsed.modelID, variant: input.variant },
          })
          if (result.error) {
            UI.error(formatRunError(result.error))
          } else {
            process.stdout.write(`已切换到模型: ${parsed.providerID}/${parsed.modelID}\n`)
          }
        } catch (e) {
          UI.error(formatRunError(e))
        }
        return "continue"
      }
      const parsed = parseModelInput(args.trim())
      if (!parsed) {
        UI.error("模型格式无效，请使用 provider/model 格式，如 deepseek/deepseek-v4-flash")
        return "continue"
      }
      try {
        const result = await sdk.v2.session.switchModel({
          sessionID,
          model: { providerID: parsed.providerID, id: parsed.modelID, variant: input.variant },
        })
        if (result.error) {
          UI.error(formatRunError(result.error))
        } else {
          process.stdout.write(`已切换到模型: ${parsed.providerID}/${parsed.modelID}\n`)
        }
      } catch (e) {
        UI.error(formatRunError(e))
      }
      return "continue"
    }
    case "agent": {
      if (!args.trim()) {
        try {
          const session = await sdk.session.get({ sessionID })
          const currentAgent = session.data?.agent ?? "build"
          process.stdout.write(`当前 agent: ${currentAgent}\n`)
          const listRes = await sdk.v2.agent.list()
          const agents = (listRes.data?.data ?? []).filter((a) => !a.hidden)
          const choices: ListChoice[] = agents.map((a) => ({
            label: `${a.id}${a.description ? ` — ${a.description}` : ""}${a.id === currentAgent ? "  ✓" : ""}`,
            value: a.id,
          }))
          if (choices.length > 0) {
            const chosen = await selectFromList("选择 agent（↑/↓ 或输入编号，Enter 确认）", choices)
            if (chosen && chosen !== currentAgent) {
              const result = await sdk.v2.session.switchAgent({ sessionID, agent: chosen })
              if (result.error) {
                UI.error(formatRunError(result.error))
              } else {
                process.stdout.write(`已切换到 agent: ${chosen}\n`)
              }
            } else if (chosen) {
              process.stdout.write("未变化。\n")
            } else {
              process.stdout.write("已取消。\n")
            }
          }
        } catch (e) {
          UI.error(formatRunError(e))
        }
        return "continue"
      }
      try {
        const result = await sdk.v2.session.switchAgent({ sessionID, agent: args.trim() })
        if (result.error) {
          UI.error(formatRunError(result.error))
        } else {
          process.stdout.write(`已切换到 agent: ${args.trim()}\n`)
        }
      } catch (e) {
        UI.error(formatRunError(e))
      }
      return "continue"
    }
    case "status": {
      try {
        const [cfg, session] = await Promise.all([
          sdk.config.get(),
          sdk.session.get({ sessionID }),
        ])
        const data = session.data
        if (!data) {
          UI.error("无法读取会话状态")
          return "continue"
        }
        const model = data.model
          ? `${data.model.providerID}/${data.model.id}${data.model.variant && data.model.variant !== "default" ? ` (${data.model.variant})` : ""}`
          : (cfg.data?.model ?? "default")
        process.stdout.write(
          [
            `版本:   ${data.version}`,
            `会话:   ${data.id.slice(0, 8)}`,
            `模型:   ${model}`,
            `agent:  ${data.agent ?? "build"}`,
            `标题:   ${data.title || "(未命名)"}`,
            `目录:   ${data.directory}`,
          ].join("\n") + "\n",
        )
      } catch (e) {
        UI.error(formatRunError(e))
      }
      return "continue"
    }
    case "cost": {
      try {
        const session = await sdk.session.get({ sessionID })
        const data = session.data
        if (!data) {
          UI.error("无法读取会话成本")
          return "continue"
        }
        const t = data.tokens
        const tokens = t
          ? `输入 ${t.input} · 输出 ${t.output} · 推理 ${t.reasoning} · 缓存读 ${t.cache.read} / 写 ${t.cache.write}`
          : "无 token 统计"
        const cost = data.cost !== undefined ? `$${(data.cost / 1000).toFixed(4)}` : "无成本统计"
        process.stdout.write(`Token: ${tokens}\n成本: ${cost}\n`)
      } catch (e) {
        UI.error(formatRunError(e))
      }
      return "continue"
    }
    case "context": {
      try {
        const result = await sdk.v2.session.context({ sessionID })
        if (result.error) {
          UI.error(formatRunError(result.error))
        } else {
          const messages = result.data?.data ?? []
          process.stdout.write(`当前上下文包含 ${messages.length} 条消息。\n`)
        }
      } catch (e) {
        UI.error(formatRunError(e))
      }
      return "continue"
    }
    case "permissions": {
      try {
        const session = await sdk.session.get({ sessionID })
        const rules = session.data?.permission
        if (!rules || rules.length === 0) {
          process.stdout.write("当前会话无权限规则（使用默认权限）。\n")
        } else {
          process.stdout.write(
            "当前会话权限:\n" +
              rules
                .map((r) => `  ${r.permission} ${r.action} ${r.pattern ?? "*"}`)
                .join("\n") +
              "\n",
          )
        }
      } catch (e) {
        UI.error(formatRunError(e))
      }
      return "continue"
    }
    default:
      process.stdout.write(
        `未知命令 /${command}。输入 /help 查看可用命令。\n`,
      )
      return "continue"
  }
}

// 当前会话 ID 的可变引用，供 /clear 重建会话后更新。
let currentSessionId = ""

const HELP_TEXT = [
  "gyc 纯 CLI 交互",
  "",
  "  直接输入问题并回车，逐轮对话（同一会话内保持上下文）。",
  "  斜杠命令：",
  "    /exit  /quit       退出",
  "    /help              显示本帮助",
  "    /clear  /new       清空当前会话上下文，开启全新会话",
  "    /compact           压缩当前会话上下文（保留摘要）",
  "    /model [name]      查看当前模型，或切换模型（如 /model deepseek/deepseek-v4-flash）",
  "    /agent [name]      查看当前 agent，或切换 agent",
  "    /status            显示版本/模型/会话/目录信息",
  "    /cost              显示当前会话 token 用量与成本",
  "    /context           显示当前会话上下文消息数",
  "    /permissions       显示当前会话权限规则",
  "  模式切换：",
  "    gyc tui            切换到全屏 TUI（当前 CLI 退出，由 TUI 接管）",
  "    gyc --mini         切换到 split-footer 交互（当前 CLI 退出，由 mini 接管）",
  "",
  "  提示：输入 / 后按 Tab 可补全命令。",
  "",
  "  Ctrl-C 退出。",
].join("\n")

// readline 补全候选：输入 / 后按 Tab 列出可用命令。
const SLASH_COMMANDS = [
  "/help",
  "/clear",
  "/new",
  "/compact",
  "/model",
  "/agent",
  "/status",
  "/cost",
  "/context",
  "/permissions",
  "/exit",
  "/quit",
]

async function interactiveLoop(input: CliInput) {
  const root = Filesystem.resolve(process.env.PWD ?? process.cwd())
  const directory = input.directory ?? root
  const sdk = await createLocalClient(directory)
  const model = parseModelInput(input.model)
  const created = await sdk.session.create({
    title: undefined,
    agent: input.agent,
    model: model
      ? {
          providerID: model.providerID,
          id: model.modelID,
          variant: input.variant,
        }
      : undefined,
    permission: [...INTERACTIVE_PERMISSIONS],
  })
  const sessionID = created.data?.id
  if (!sessionID) {
    UI.error("Failed to create session")
    process.exit(1)
  }

  // 自定义 raw 模式输入 + 实时斜杠命令菜单（Codex 风格）。
  // 布局：输入行（› ...）在上，命令菜单行在下。每次按键用 \r 清行重绘。
  const CYAN_PROMPT = "\x1b[96m"
  const DIM_MENU = "\x1b[90m"
  const RESET = "\x1b[0m"
  const promptWithMenu = (): Promise<string> =>
    new Promise((resolve) => {
      let buffer = ""
      let cursor = 0
      let selected = 0
      let menu: string[] = []
      const render = () => {
        // 输入行：回到行首清行，重绘提示符 + 输入 + 光标归位。
        process.stdout.write("\r\x1b[K" + CYAN_PROMPT + "?\x1b[0m " + buffer)
        const back = buffer.length - cursor
        if (back > 0) process.stdout.write("\x1b[" + back + "D")
        // 菜单行：清行，若有命令则显示。
        process.stdout.write("\n\x1b[K")
        if (menu.length > 0) {
          process.stdout.write(
            DIM_MENU + menu.map((c, i) => (i === selected ? CYAN_PROMPT + c + RESET : c)).join("   ") + RESET,
          )
        }
        // 光标回到输入行。
        process.stdout.write("\x1b[1A")
      }
      const refreshMenu = () => {
        const m = /^\/([^\s]*)/.exec(buffer)
        // 输入 / 或 /前缀 时显示匹配命令；仅一个 / 时显示全部命令。
        menu = m
          ? SLASH_COMMANDS.filter((cmd) => cmd.startsWith("/" + m[1]) && cmd !== buffer.trim())
          : []
        selected = 0
      }
      let esc = ""
      const input = process.stdin
      input.setRawMode(true)
      input.resume()
      input.on("data", (chunk) => {
        const bytes = typeof chunk === "string" ? Buffer.from(chunk, "utf8") : chunk
        for (const byte of bytes) {
          const ch = byte as number
          if (esc) {
            esc += String.fromCharCode(ch)
            if (esc.length === 3) {
              if (esc === "\x1b[A" && menu.length > 0) {
                selected = (selected - 1 + menu.length) % menu.length
                buffer = menu[selected]!
                cursor = buffer.length
                render()
              } else if (esc === "\x1b[B" && menu.length > 0) {
                selected = (selected + 1) % menu.length
                buffer = menu[selected]!
                cursor = buffer.length
                render()
              }
              esc = ""
            }
            continue
          }
          if (ch === 3) {
            process.stdout.write("\n")
            input.setRawMode(false)
            input.pause()
            process.exit(0)
          } else if (ch === 13 || ch === 10) {
            process.stdout.write("\r\x1b[K\n")
            input.setRawMode(false)
            input.pause()
            resolve(buffer)
            return
          } else if (ch === 9) {
            if (menu.length > 0) {
              selected = (selected + 1) % menu.length
              buffer = menu[selected]!
              cursor = buffer.length
              render()
            }
          } else if (ch === 127 || ch === 8) {
            if (cursor > 0) {
              buffer = buffer.slice(0, cursor - 1) + buffer.slice(cursor)
              cursor--
              refreshMenu()
              render()
            }
          } else if (ch === 27) {
            esc = "\x1b"
          } else {
            buffer = buffer.slice(0, cursor) + String.fromCharCode(ch) + buffer.slice(cursor)
            cursor++
            refreshMenu()
            render()
          }
        }
      })
      render()
    })

  currentSessionId = sessionID
  await renderWelcome(sdk, sessionID, input)
  // 终端窗口/标签页关闭时自动退出，避免 CLI 残留为孤儿进程占用内存。
  const cancelTerminalWatch = watchTerminalClose(() => {
    try {
      process.stdin.setRawMode(false)
    } catch {}
    process.exit(0)
  })
  try {
    for (;;) {
      // Codex 风格的输入提示符：? （亮青色），带实时斜杠命令菜单。
      const line = await promptWithMenu()
      const text = line.trim()
      if (!text) continue
      if (text === "/exit" || text === "/quit") break
      if (text === "/help") {
        process.stdout.write(HELP_TEXT + "\n")
        continue
      }
      // 模式切换：`gyc tui` / `gyc --mini`（或裸 `tui` / `--mini`）由 Bun 子进程
      // 接管全屏交互（OpenTUI 仅支持 Bun）。先关闭 readline 恢复终端，再拉起
      // 子进程；切换后本 CLI 进程退出（子进程独立运行，退出后回到 shell）。
      if (/^(?:gyc\s+)?tui(?:\s+.*)?$/i.test(text)) {
        process.stdin.setRawMode(false)
        process.stdin.pause()
        const code = spawnBunSync(["tui"])
        if (code === undefined) {
          UI.error("TUI 需要 Bun 运行时产物（dist-bun 缺失或启动失败），请重新构建：bun run build")
          process.exit(1)
        }
        process.exit(code)
      }
      if (/^(?:gyc\s+)?(?:--mini|-i)$/i.test(text)) {
        process.stdin.setRawMode(false)
        process.stdin.pause()
        const code = spawnBunSync(["--mini"])
        if (code === undefined) {
          UI.error("TUI 需要 Bun 运行时产物（dist-bun 缺失或启动失败），请重新构建：bun run build")
          process.exit(1)
        }
        process.exit(code)
      }
      const sub = /^gyc\s+(\S+)/i.exec(text)
      if (sub) {
        process.stdout.write(`交互模式内仅支持 tui / --mini 切换；其他子命令请 /exit 后运行 gyc ${sub[1]}\n`)
        continue
      }
      if (text.startsWith("/")) {
        const [command, ...rest] = text.slice(1).split(" ")
        // 命令前缀自动补全：若输入是某个斜杠命令的前缀（且非精确命中），
        // 自动补全为完整命令（Codex 风格：输入 /mo → 执行 /model）。
        const full = "/" + command
        if (!SLASH_COMMANDS.includes(full)) {
          const matches = SLASH_COMMANDS.filter((cmd) => cmd.startsWith(full))
          if (matches.length === 1) {
            const [matched] = matches
            process.stdout.write(`${matched}\n`)
            const [fullCmd, ...fullRest] = matched.slice(1).split(" ")
            const outcome = await runSlashCommand(sdk, currentSessionId, fullCmd, [fullRest.join(" "), rest.join(" ")].filter(Boolean).join(" "), input)
            if (outcome === "exit") break
            continue
          }
        }
        const outcome = await runSlashCommand(sdk, currentSessionId, command, rest.join(" "), input)
        if (outcome === "exit") break
        continue
      }
      await runTurn(sdk, currentSessionId, text, input)
      await renderStatusLine(sdk, currentSessionId, input)
    }
  } finally {
    cancelTerminalWatch()
    process.stdin.setRawMode(false)
    process.stdin.pause()
  }
}

export const DefaultCommand = effectCmd({
  command: "$0 [message..]",
  describe: "gyc 默认入口：传消息则非交互单轮；无参数进入逐行对话；--tui 进入全屏 TUI",
  instance: (args) => !args.attach,
  directory: (args) => (args.dir && !args.attach ? path.resolve(process.cwd(), args.dir) : process.cwd()),
  builder: (yargs: Argv) =>
    yargs
      .positional("message", {
        describe: "message to send",
        type: "string",
        array: true,
        default: [],
      })
      .option("command", {
        describe: "the command to run, use message for args",
        type: "string",
      })
      .option("continue", {
        alias: ["c"],
        describe: "continue the last session",
        type: "boolean",
      })
      .option("session", {
        alias: ["s"],
        describe: "session id to continue",
        type: "string",
      })
      .option("fork", {
        describe: "fork the session before continuing (requires --continue or --session)",
        type: "boolean",
      })
      .option("share", {
        type: "boolean",
        describe: "share the session",
      })
      .option("model", {
        type: "string",
        alias: ["m"],
        describe: "model to use in the format of provider/model",
      })
      .option("agent", {
        type: "string",
        describe: "agent to use",
      })
      .option("format", {
        type: "string",
        choices: ["default", "json"],
        default: "default",
        describe: "format: default (formatted) or json (raw JSON events)",
      })
      .option("file", {
        alias: ["f"],
        type: "string",
        array: true,
        describe: "file(s) to attach to message",
      })
      .option("title", {
        type: "string",
        describe: "title for the session (uses truncated prompt if no value provided)",
      })
      .option("attach", {
        type: "string",
        describe: "attach to a running gyc server (e.g., http://localhost:4096)",
      })
      .option("password", {
        alias: ["p"],
        type: "string",
        describe: "basic auth password (defaults to GYCCODE_SERVER_PASSWORD)",
      })
      .option("username", {
        alias: ["u"],
        type: "string",
        describe: "basic auth username (defaults to GYCCODE_SERVER_USERNAME or 'gyccode')",
      })
      .option("dir", {
        type: "string",
        describe: "directory to run in, path on remote server if attaching",
      })
      .option("port", {
        type: "number",
        describe: "port for the local server (defaults to random port if no value provided)",
      })
      .option("variant", {
        type: "string",
        describe: "model variant (provider-specific reasoning effort, e.g., high, max, minimal)",
      })
      .option("thinking", {
        type: "boolean",
        describe: "show thinking blocks",
      })
      .option("mini", {
        type: "boolean",
        hidden: true,
        default: false,
      })
      .option("interactive", {
        alias: ["i"],
        type: "boolean",
        hidden: true,
        describe: "legacy alias for --mini",
        default: false,
      })
      .option("auto", {
        type: "boolean",
        describe: "auto-approve permissions that are not explicitly denied (dangerous!)",
        default: false,
      })
      .option("yolo", {
        type: "boolean",
        hidden: true,
        default: false,
      })
      .option("dangerously-skip-permissions", {
        type: "boolean",
        hidden: true,
        default: false,
      })
      .option("demo", {
        type: "boolean",
        default: false,
        hidden: true,
      }),
  handler: Effect.fn("Cli.default")(function* (args) {
    yield* Effect.promise(async () => {
      const mini = args.mini || args.interactive
      if (mini) {
        // --mini 转发 TUI 的 split-footer 交互（Node 下 index.ts 已提升到 Bun）。
        const { runMini } = await import("./run")
        await runMini({
          directory: args.dir,
          attach: args.attach,
          password: args.password,
          username: args.username,
          continue: args.continue,
          session: args.session,
          fork: args.fork,
          model: args.model,
          agent: args.agent,
          prompt: [...args.message, ...(args["--"] || [])].join(" "),
          demo: args.demo,
        })
        return
      }

      const message = [...args.message, ...(args["--"] || [])].join(" ")
      // 仅在无 message/command 时才读取 stdin（有参数时不阻塞等待管道/终端 EOF）。
      const piped =
        message.trim() || args.command
          ? undefined
          : process.stdin.isTTY
            ? undefined
            : await readStdin()
      const hasInput = Boolean(message.trim() || piped?.trim() || args.command)

      if (hasInput) {
        // 非交互单轮：复用 gyc run 的完整 handler（行为完全一致）。
        // stdin 已在上面消费，把管道内容合并进 message 再转发，避免二次读取为空。
        const combined = message.trim() ? message : (piped ?? "")
        await RunCommand.handler({
          ...args,
          _: args._ ?? [],
          message: combined ? [combined] : [],
        } as never)
        return
      }

      // 无消息、无管道、stdout 非 TTY（纯脚本环境）→ 无输入可做，报错退出。
      if (!process.stdout.isTTY) {
        UI.error("You must provide a message or a command")
        process.exit(1)
      }

      // 逐行对话（纯 CLI，Node 直跑）。
      await interactiveLoop({
        directory: args.dir,
        model: args.model,
        variant: args.variant,
        agent: args.agent,
        thinking: args.thinking ?? false,
        auto: args.auto || args.yolo || args["dangerously-skip-permissions"],
      })
    })
  }),
})
