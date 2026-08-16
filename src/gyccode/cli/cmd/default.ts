// 纯 CLI 默认入口（gyc / gyc "消息"）。
//
// 三种形态：
//   1. 传消息或 stdin 管道 → 非交互单轮（复用 RunCommand.handler，行为与 `gyc run` 完全一致）。
//   2. 无参数且 stdout 为 TTY → 逐行对话（node:readline，Node 直跑，不依赖 OpenTUI）。
import path from "path"
import { pathToFileURL } from "url"
import type { Argv } from "yargs"
import { Effect } from "effect"
import { UI } from "../ui"
import { effectCmd } from "../effect-cmd"
import { readStdin } from "../../../core/util/read-stdin"
import { Filesystem } from "@/util/filesystem"
import { createGyccodeClient, type CommandV2Info, type GyccodeClient } from "@gyccode/protocol/v2"
import { FormatError, FormatUnknownError } from "../error"
import { streamLoop, type SubagentInfo } from "./run/stream-cli"
import { InstallationVersion } from "@gyccode/core/installation/version"
import type { PermissionV1 } from "@gyccode/core/v1/permission"
import { RunCommand } from "./run"
import { writeClipboardOsc52, writeCopyTempFile } from "./run/copy.shared"
import { watchTerminalClose } from "@gyccode/tui/terminal-win32"

function formatRunError(error: unknown) {
  return FormatError(error) ?? FormatUnknownError(error)
}

// 交互模式下权限与问题问答由 streamLoop 的 interactive 回调在线处理
// （permission: y=允许一次 / a=始终允许 / n=拒绝；question: 逐问回答）。
// plan_enter/plan_exit 保持拒绝（plan 模式仅通过 gyc tui / gyc web 使用）。
const INTERACTIVE_PERMISSIONS: PermissionV1.Ruleset = [
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
  files?: string[]
}

type SubagentRecord = SubagentInfo & { at: string }

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

// 交互模式下的临时单行输入（readline 独立实例；raw 输入循环已暂停 stdin）。
async function readLine(prompt: string): Promise<string> {
  const { createInterface } = await import("node:readline/promises")
  const rl = createInterface({ input: process.stdin, output: process.stdout })
  try {
    return await rl.question(prompt)
  } finally {
    rl.close()
    try {
      process.stdin.pause()
    } catch {}
  }
}

// 构建 streamLoop 的交互回调：权限审批（y/a/n）与问题问答（数字选择/自定义）。
function createStreamInteractive(): NonNullable<Parameters<typeof streamLoop>[0]["interactive"]> {
  return {
    askPermission: async (permission) => {
      UI.println(
        UI.Style.TEXT_WARNING_BOLD + "!",
        UI.Style.TEXT_NORMAL +
          `permission requested: ${permission.permission} (${permission.patterns.join(", ")})`,
      )
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
        UI.println(`  Q${index + 1}: ${question.question}`)
        question.options.forEach((option, j) =>
          UI.println(`    [${j + 1}] ${option.label}${option.description ? " — " + option.description : ""}`),
        )
        if (question.custom !== false) UI.println("    [0] 自定义答案")
      })
      const line = await readLine("  回答（每问用 | 分隔，多选用逗号）: ")
      const parts = line.split("|")
      return request.questions.map((question, index) => {
        const raw = (parts[index] ?? "").trim()
        if (!raw) return []
        return raw
          .split(",")
          .map((item) => item.trim())
          .filter(Boolean)
          .map((item) => {
            const num = Number(item)
            if (Number.isInteger(num) && num >= 1 && num <= question.options.length) {
              return question.options[num - 1]!.label
            }
            return item
          })
      })
    },
  }
}

// 把 --file 附加文件解析为 file part（本地路径引用，复用 run 单轮的文件语义）。
async function resolveFileParts(files: string[], directory?: string): Promise<Array<{ type: "file"; url: string; filename: string; mime: string }>> {
  const parts: Array<{ type: "file"; url: string; filename: string; mime: string }> = []
  for (const filePath of files) {
    const resolved = path.resolve(directory ?? process.cwd(), filePath)
    if (!(await Filesystem.exists(resolved))) {
      process.stdout.write(`文件不存在：${filePath}\n`)
      continue
    }
    parts.push({
      type: "file",
      url: pathToFileURL(resolved).href,
      filename: path.basename(resolved),
      mime: "text/plain",
    })
  }
  return parts
}

// 订阅事件流并渲染到 stdout，同时收集子代理（task 工具）状态供 /subagents 使用。
function runStreamLoop(
  sdk: GyccodeClient,
  sessionID: string,
  input: CliInput,
  subagents: SubagentRecord[],
): Promise<string | undefined> {
  return sdk.event.subscribe().then((events) =>
    streamLoop({
      client: sdk,
      events,
      sessionID,
      format: "default",
      thinking: input.thinking,
      auto: input.auto,
      interactive: createStreamInteractive(),
      question: {
        reply: (requestID, answers) => sdk.v2.session.question.reply({ sessionID, requestID, questionV2Reply: { answers } }),
        reject: (requestID) => sdk.v2.session.question.reject({ sessionID, requestID }),
      },
      onSubagent: (info) => subagents.push({ ...info, at: new Date().toLocaleTimeString() }),
    }),
  )
}

// 一轮对话：订阅事件流 → prompt → 流式渲染直到 idle。

async function runTurn(sdk: GyccodeClient, sessionID: string, text: string, input: CliInput, subagents: SubagentRecord[]) {
  const fileParts = await resolveFileParts(input.files ?? [], input.directory)
  const completed = runStreamLoop(sdk, sessionID, input, subagents)
  const result = await sdk.session.prompt({
    sessionID,
    model: parseModelInput(input.model),
    variant: input.variant,
    parts: [...fileParts, { type: "text", text }],
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
  dynamicCommands: Map<string, CommandV2Info>,
  subagents: SubagentRecord[],
): Promise<"continue" | "exit"> {
  const dynamic = dynamicCommands.get(command)
  if (dynamic) {
    // 动态命令（内置 init/review、技能、项目命令、MCP 命令）：经 session.command 服务端执行。
    try {
      const completed = runStreamLoop(sdk, sessionID, input, subagents)
      const result = await sdk.session.command({ sessionID, command: dynamic.name, arguments: args })
      if (result.error) UI.error(formatRunError(result.error))
      await completed
    } catch (e) {
      UI.error(formatRunError(e))
    }
    return "continue"
  }
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
    case "continue":
    case "resume": {
      let target = args.trim()
      if (!target) {
        try {
          const list = await sdk.session.list()
          const sessions = (list.data ?? []).filter((s) => s && typeof s.id === "string")
          if (sessions.length === 0) {
            process.stdout.write("没有可继续的会话。\n")
            return "continue"
          }
          process.stdout.write("最近会话（按更新时间排序）：\n")
          const choices: ListChoice[] = sessions.slice(0, 10).map((s) => ({
            label: `${s.title || s.id}${s.agent ? ` [${s.agent}]` : ""}`,
            value: s.id,
          }))
          const chosen = await selectFromList("选择要继续的会话（Enter 确认）", choices)
          if (!chosen) {
            process.stdout.write("已取消。\n")
            return "continue"
          }
          target = chosen
        } catch (e) {
          UI.error(formatRunError(e))
          return "continue"
        }
      }
      try {
        const session = await sdk.session.get({ sessionID: target }).catch(() => undefined)
        if (!session?.data) {
          UI.error(`会话不存在: ${target}`)
          return "continue"
        }
        currentSessionId = target
        process.stdout.write(`已继续会话: ${target}（${session.data.title || "(未命名)"}）\n`)
      } catch (e) {
        UI.error(formatRunError(e))
      }
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
    case "variant": {
      try {
        const session = await sdk.session.get({ sessionID })
        const current = session.data?.model
        if (!current) {
          UI.error("当前会话未设置显式模型，无法查看/切换变体")
          return "continue"
        }
        const listRes = await sdk.v2.model.list()
        const info = (listRes.data?.data ?? []).find(
          (m) => m.providerID === current.providerID && m.id === current.id,
        )
        const variants = (info?.variants ?? []).map((v) => v.id)
        const currentVariant = current.variant && current.variant !== "default" ? current.variant : undefined
        const applyVariant = async (variant: string | undefined) => {
          const result = await sdk.v2.session.switchModel({
            sessionID,
            model: { providerID: current.providerID, id: current.id, variant },
          })
          if (result.error) {
            UI.error(formatRunError(result.error))
          } else {
            process.stdout.write(`已切换变体: ${variant ?? "默认"}\n`)
          }
        }
        if (!args.trim()) {
          if (variants.length === 0) {
            process.stdout.write(`模型 ${current.providerID}/${current.id} 无可用变体（当前: ${currentVariant ?? "默认"}）。\n`)
            return "continue"
          }
          const choices: ListChoice[] = [
            { label: `默认${currentVariant ? "" : "  ✓"}`, value: "" },
            ...variants.map((v) => ({
              label: `${v}${v === currentVariant ? "  ✓" : ""}`,
              value: v,
            })),
          ]
          const chosen = await selectFromList(`选择变体（当前: ${currentVariant ?? "默认"}）`, choices)
          if (chosen === undefined) {
            process.stdout.write("已取消。\n")
            return "continue"
          }
          await applyVariant(chosen || undefined)
          return "continue"
        }
        const target = args.trim()
        if (target !== "default" && !variants.includes(target)) {
          UI.error(`变体不可用: ${target}（可选: ${variants.join(", ") || "无"}）`)
          return "continue"
        }
        await applyVariant(target === "default" ? undefined : target)
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
        const [ctxRes, session] = await Promise.all([
          sdk.v2.session.context({ sessionID }),
          sdk.session.get({ sessionID }).catch(() => undefined),
        ])
        if (ctxRes.error) {
          UI.error(formatRunError(ctxRes.error))
          return "continue"
        }
        const messages = ctxRes.data?.data ?? []
        const data = session?.data
        const model = data?.model
          ? `${data.model.providerID}/${data.model.id}${data.model.variant && data.model.variant !== "default" ? ` (${data.model.variant})` : ""}`
          : undefined
        const t = data?.tokens
        const tokens = t
          ? `输入 ${t.input} · 输出 ${t.output} · 推理 ${t.reasoning} · 缓存读 ${t.cache.read} / 写 ${t.cache.write}`
          : undefined
        const userCount = messages.filter((m) => m.type === "user").length
        const assistantCount = messages.filter((m) => m.type === "assistant").length
        const otherCount = messages.length - userCount - assistantCount
        process.stdout.write(
          [
            `上下文：${messages.length} 条消息`,
            ...(model ? [`模型:   ${model}`] : []),
            ...(tokens ? [`Token:  ${tokens}`] : []),
            `消息:   用户 ${userCount} · 助手 ${assistantCount}${otherCount > 0 ? ` · 其他 ${otherCount}` : ""}`,
          ].join("\n") + "\n",
        )
      } catch (e) {
        UI.error(formatRunError(e))
      }
      return "continue"
    }
    case "copy": {
      try {
        const res = await sdk.session.messages({ sessionID })
        if (res.error) {
          UI.error(formatRunError(res.error))
          return "continue"
        }
        const messages = res.data ?? []
        const texts: string[] = []
        for (let i = messages.length - 1; i >= 0 && texts.length < 20; i--) {
          const msg = messages[i]
          if (!msg || msg.info.role !== "assistant") continue
          const text = msg.parts
            .filter((p) => p.type === "text")
            .map((p) => (p as { text: string }).text)
            .join("\n\n")
            .trim()
          if (text) texts.push(text)
        }
        const content = texts.join("\n\n---\n\n")
        if (!content) {
          process.stdout.write("当前会话没有可复制的助手回复。\n")
          return "continue"
        }
        const charCount = content.length
        const lineCount = content.split("\n").length
        const tmpPath = await writeCopyTempFile(content)
        const copied = writeClipboardOsc52(content)
        process.stdout.write(`已复制 ${charCount} 字符 ${lineCount} 行${copied ? "" : "（终端不支持剪贴板）"}。\n`)
        if (tmpPath) process.stdout.write(`同时已写入 ${tmpPath}\n`)
      } catch (e) {
        UI.error(formatRunError(e))
      }
      return "continue"
    }
    case "branch": {
      try {
        const res = await sdk.session.fork({ sessionID })
        if (res.error) {
          UI.error(formatRunError(res.error))
          return "continue"
        }
        const next = res.data?.id
        if (!next) {
          UI.error("分支创建失败")
          return "continue"
        }
        currentSessionId = next
        process.stdout.write(`已分支会话：${res.data?.title ?? "(未命名)"}\n当前会话已切换到分支。原会话可用 /continue 恢复。\n`)
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
    case "editor": {
      // 外部编辑器（$EDITOR / $VISUAL）编写消息。
      try {
        const { tmpdir } = await import("os")
        const { spawnSync } = await import("node:child_process")
        const editor = process.env.EDITOR || process.env.VISUAL
        if (!editor) {
          process.stdout.write("未检测到编辑器。请设置 EDITOR 环境变量（Windows 示例：`set EDITOR=code --wait`）。\n")
          return "continue"
        }
        const tmpFile = path.join(tmpdir(), `gyc-editor-${Date.now()}.md`)
        const result = spawnSync(editor, [tmpFile], { stdio: "inherit", shell: true })
        if (result.status !== 0) {
          UI.error(`编辑器退出码 ${result.status ?? "unknown"}`)
          return "continue"
        }
        const content = await Filesystem.readText(tmpFile).catch(() => "")
        try {
          const { unlink } = await import("node:fs/promises")
          await unlink(tmpFile)
        } catch {}
        if (!content.trim()) {
          process.stdout.write("编辑器内容为空，已取消。\n")
          return "continue"
        }
        await runTurn(sdk, sessionID, content.trim(), input, subagents)
      } catch (e) {
        UI.error(formatRunError(e))
      }
      return "continue"
    }
    case "subagents": {
      if (subagents.length === 0) {
        process.stdout.write("当前会话暂无子代理运行记录。子代理（task 工具）状态会在每轮结束时记录。\n")
      } else {
        process.stdout.write("最近子代理（task 工具）:\n")
        for (const item of subagents.slice(-20).reverse()) {
          const mark = item.status === "running" ? "•" : item.status === "completed" ? "✓" : "✗"
          process.stdout.write(`  ${mark} ${item.type}${item.description ? ` — ${item.description}` : ""} [${item.status}] ${item.at}\n`)
        }
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
  "    /continue [id]    继续最近会话（无参数时列出最近 10 个供选择）",
  "    /compact           压缩当前会话上下文（保留摘要）",
  "    /model [name]      查看当前模型，或切换模型（如 /model deepseek/deepseek-v4-flash）",
  "    /variant [name]   查看当前模型变体，或切换（如 /variant high）",
  "    /agent [name]      查看当前 agent，或切换 agent",
  "    /status            显示版本/模型/会话/目录信息",
  "    /cost              显示当前会话 token 用量与成本",
  "    /context           显示当前会话上下文消息数",
  "    /copy              复制最近助手回复到剪贴板（同时写入临时文件兜底）",
  "    /branch            分支当前会话并切换到新分支",
  "    /permissions       显示当前会话权限规则",
  "    /editor            在外部编辑器（$EDITOR）中编写消息",
  "    /subagents         查看最近子代理运行状态",
  "  模式切换：",
  "    gyc tui            切换到全屏 TUI（当前 CLI 退出，由 TUI 接管）",
  "",
  "  提示：输入 / 后按 Tab 可补全命令。",
  "",
  "  Ctrl-C 退出。",
].join("\n")

// readline 补全候选：输入 / 后按 Tab 列出可用命令。
const SLASH_COMMANDS = [
  "/help",
  "/clear",
  "/continue",
  "/resume",
  "/new",
  "/compact",
  "/model",
  "/variant",
  "/agent",
  "/status",
  "/cost",
  "/context",
  "/copy",
  "/branch",
  "/permissions",
  "/editor",
  "/subagents",
  "/exit",
  "/quit",
]

// 轻量解析 `tui [project] [--flag[=value]]` 文本为 TuiThreadCommand.handler 的 argv。
// 交互模式内切换 TUI 无需再拉起 Bun 子进程（OpenTUI 经 koffi 支持 Node，无 dist-bun 产物）。
const TUI_FLAG_KINDS: Record<string, "boolean" | "string"> = {
  model: "string",
  m: "string",
  continue: "boolean",
  c: "boolean",
  session: "string",
  s: "string",
  fork: "boolean",
  prompt: "string",
  agent: "string",
  auto: "boolean",
  yolo: "boolean",
  "dangerously-skip-permissions": "boolean",
  port: "string",
  hostname: "string",
  mdns: "boolean",
  "no-mdns": "boolean",
  "mdns-domain": "string",
  cors: "boolean",
}
function parseTuiArgs(rest: string): Record<string, unknown> {
  const argv: Record<string, unknown> = {}
  const tokens = rest.split(/\s+/).filter(Boolean)
  for (let i = 0; i < tokens.length; i++) {
    const token = tokens[i]!
    if (token.startsWith("--")) {
      const [rawName, ...valueParts] = token.slice(2).split("=")
      const name = rawName!
      const inline = valueParts.join("=")
      const kind = TUI_FLAG_KINDS[name]
      // 布尔 flag：`--flag` 或 `--flag=true/false`；字符串 flag：内联值或下一 token。
      let value: unknown = true
      if (kind === "boolean") value = inline === "" ? true : inline !== "false"
      else if (kind === "string") value = inline === "" ? tokens[++i] ?? "" : inline
      const camel = name.replace(/-([a-z])/g, (_m, ch: string) => ch.toUpperCase())
      argv[camel] = value
      argv[name] = value // kebab 键同时保留（handler 有括号访问 kebab 的场景）
    } else if (!token.startsWith("-")) {
      argv.project = token
    }
  }
  return argv
}

async function interactiveLoop(input: CliInput) {
  const root = Filesystem.resolve(process.env.PWD ?? process.cwd())
  const directory = input.directory ?? root
  const sdk = await createLocalClient(directory)
  // 动态命令（内置 init/review、技能、项目命令、MCP 命令）：来自服务端 command.list。
  const dynamicCommands = new Map<string, CommandV2Info>()
  try {
    const res = await sdk.v2.command.list({ location: { directory } })
    for (const item of res.data?.data ?? []) {
      if (item.name) dynamicCommands.set(item.name, item)
    }
  } catch {}
  const commandCandidates = () => {
    const names = new Set<string>()
    for (const cmd of SLASH_COMMANDS) names.add(cmd)
    for (const name of dynamicCommands.keys()) names.add("/" + name)
    return [...names].sort()
  }
  // 子代理运行记录（/subagents 数据源）：由 streamLoop 的 onSubagent 回调收集。
  const subagents: SubagentRecord[] = []
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
      // 流式 UTF-8 解码器：中文 IME 输入以多字节序列到达，且可能跨 chunk 拆分。
      // stream:true 语义下，不完整的尾部序列由解码器内部暂存，直到后续字节补齐
      // 才输出完整字符——逐字节喂入即可，无需手工维护字节缓冲区。
      // （注意：非流式 decode 会把不完整序列直接替换为 U+FFFD，造成中文乱码。）
      const decoder = new TextDecoder("utf-8")
      const decodeByte = (b: number): string => decoder.decode(new Uint8Array([b]), { stream: true })
      const flushDecoder = (): string => decoder.decode()

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
          ? commandCandidates().filter((cmd) => cmd.startsWith("/" + m[1]) && cmd !== buffer.trim())
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
            // 刷新解码器（处理可能残留的不完整 UTF-8 序列）
            buffer += flushDecoder()
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
            // 退格：先刷新解码器，再删除一个字符
            buffer += flushDecoder()
            if (cursor > 0) {
              buffer = buffer.slice(0, cursor - 1) + buffer.slice(cursor)
              cursor--
              refreshMenu()
              render()
            }
          } else if (ch === 27) {
            esc = "\x1b"
          } else {
            // 普通字符：流式解码；不完整的多字节序列由解码器暂存，返回空串
            const decoded = decodeByte(ch)
            if (decoded) {
              buffer = buffer.slice(0, cursor) + decoded + buffer.slice(cursor)
              cursor += decoded.length
              refreshMenu()
              render()
            }
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
      // 模式切换：`gyc tui`（或裸 `tui`）在当前进程直接进入全屏 TUI
      // （OpenTUI 经 koffi 支持 Node，无需 dist-bun Bun 产物）。
      // 先关闭 readline 恢复终端，再执行 TUI；退出后本进程退出回到 shell。
      if (/^(?:gyc\s+)?tui(?:\s+.*)?$/i.test(text)) {
        process.stdin.setRawMode(false)
        process.stdin.pause()
        const { TuiThreadCommand } = await import("./tui")
        const rest = text.replace(/^(?:gyc\s+)?tui/i, "").trim()
        await TuiThreadCommand.handler(parseTuiArgs(rest) as Parameters<typeof TuiThreadCommand.handler>[0])
        process.exit(0)
      }
      const sub = /^gyc\s+(\S+)/i.exec(text)
      if (sub) {
        process.stdout.write(`交互模式内仅支持 tui 切换；其他子命令请 /exit 后运行 gyc ${sub[1]}\n`)
        continue
      }
      if (text.startsWith("/")) {
        const [command, ...rest] = text.slice(1).split(" ")
        // 命令前缀自动补全：若输入是某个斜杠命令的前缀（且非精确命中），
        // 自动补全为完整命令（Codex 风格：输入 /mo → 执行 /model）。
        const full = "/" + command
        if (!commandCandidates().includes(full)) {
          const matches = commandCandidates().filter((cmd) => cmd.startsWith(full))
          if (matches.length === 1) {
            const [matched] = matches
            process.stdout.write(`${matched}\n`)
            const [fullCmd, ...fullRest] = matched.slice(1).split(" ")
            const outcome = await runSlashCommand(sdk, currentSessionId, fullCmd, [fullRest.join(" "), rest.join(" ")].filter(Boolean).join(" "), input, dynamicCommands, subagents)
            if (outcome === "exit") break
            continue
          }
        }
        const outcome = await runSlashCommand(sdk, currentSessionId, command, rest.join(" "), input, dynamicCommands, subagents)
        if (outcome === "exit") break
        continue
      }
      await runTurn(sdk, currentSessionId, text, input, subagents)
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
        files: args.file,
      })
    })
  }),
})
