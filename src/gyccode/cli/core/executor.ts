// 内置斜杠命令执行器 - 统一入口、错误边界、重试
// 所有 /command 通过此处分发

import { type GyccodeClient, type CommandV2Info } from "@gyccode/protocol/v2"
import path from "path"
import { SessionManager } from "./session"
import { IHistoryManager } from "./history"
import { UI } from "../ui"
import { readLine } from "./input"
import { TokyoNight, Typography } from "../theme"
import { parseModelInput, resolveFileParts } from "./pipeline"

export interface ExecutorContext {
  sdk: GyccodeClient
  sessionId: string
  directory: string
  input: {
    model?: string
    variant?: string
    agent?: string
    thinking: boolean
    auto: boolean
    files?: string[]
  }
  dynamicCommands: Map<string, CommandV2Info>
  subagents: Array<{ type: string; description?: string; status: string; at: string }>
  history: IHistoryManager
}

export type BuiltinCommandHandler = (ctx: ExecutorContext, args: string) => Promise<"continue" | "exit">

const handlers = new Map<string, BuiltinCommandHandler>()

export function registerBuiltinCommand(name: string, handler: BuiltinCommandHandler, aliases: string[] = []): void {
  handlers.set(name, handler)
  for (const alias of aliases) handlers.set(alias, handler)
}

export function getBuiltinHandler(name: string): BuiltinCommandHandler | undefined {
  return handlers.get(name)
}

export function listBuiltinCommands(): string[] {
  return [...handlers.keys()].filter((v, i, a) => a.indexOf(v) === i).sort()
}

// 执行内置命令
export async function executeBuiltinCommand(
  ctx: ExecutorContext,
  command: string,
  args: string
): Promise<"continue" | "exit"> {
  const handler = handlers.get(command)
  if (!handler) {
    UI.error(`未知命令: /${command}`)
    return "continue"
  }
  try {
    return await handler(ctx, args)
  } catch (error) {
    UI.error(`命令执行失败: ${error instanceof Error ? error.message : String(error)}`)
    return "continue"
  }
}

// === 内置命令实现 ===

// /help
registerBuiltinCommand("help", async () => {
  console.log(HELP_TEXT)
  return "continue"
}, ["h", "?"])

// /exit, /quit, /q
registerBuiltinCommand("exit", async () => "exit", ["quit", "q"])

// /new, /clear
registerBuiltinCommand("new", async (ctx) => {
  const created = await ctx.sdk.session.create({
    title: undefined,
    agent: ctx.input.agent,
    permission: [
      { permission: "question", action: "deny", pattern: "*" },
      { permission: "plan_enter", action: "deny", pattern: "*" },
      { permission: "plan_exit", action: "deny", pattern: "*" },
    ],
  })
  const nextID = created.data?.id
  if (!nextID) {
    UI.error("Failed to create new session")
    return "continue"
  }
  ctx.sessionId = nextID
  console.log(`已创建新会话: ${nextID}`)
  return "continue"
}, ["clear"])

// /sessions, /continue, /resume
registerBuiltinCommand("sessions", async (ctx, args) => {
  const manager = new SessionManager({ sdk: ctx.sdk })
  let target = args.trim()

  if (!target) {
    const sessions = await manager.list({ limit: 10 })
    if (sessions.length === 0) {
      console.log("没有可继续的会话")
      return "continue"
    }
    console.log("最近会话（按更新时间排序）：")
    sessions.forEach((s, i) => {
      const time = new Date(s.updatedAt).toLocaleString()
      const title = s.title || s.id
      const agent = s.agent ? ` [${s.agent}]` : ""
      console.log(`  ${i + 1}. ${title}${agent} - ${time} (${s.id.slice(0, 8)})`)
    })

    const { createInterface } = await import("node:readline/promises")
    const rl = createInterface({ input: process.stdin, output: process.stdout })
    try {
      const answer = await rl.question("选择会话编号 (回车取消): ")
      const idx = parseInt(answer.trim(), 10) - 1
      if (idx >= 0 && idx < sessions.length) target = sessions[idx].id
    } finally {
      rl.close()
    }
  }

  if (target) {
    const session = await ctx.sdk.session.get({ sessionID: target }).catch(() => undefined)
    if (!session?.data) {
      UI.error(`会话不存在: ${target}`)
      return "continue"
    }
    ctx.sessionId = target
    console.log(`已继续会话: ${target}（${session.data.title || "(未命名)"}）`)
  }
  return "continue"
}, ["continue", "resume"])

// /compact
registerBuiltinCommand("compact", async (ctx) => {
  try {
    const result = await ctx.sdk.v2.session.compact({ sessionID: ctx.sessionId })
    if (result.error) {
      UI.error(JSON.stringify(result.error))
    } else {
      console.log("会话上下文已压缩")
    }
  } catch (e) {
    UI.error(String(e))
  }
  return "continue"
}, ["summary"])

// /model, /models
registerBuiltinCommand("model", async (ctx, args) => {
  const modelArg = args.trim()

  if (!modelArg) {
    // 交互式选择
    try {
      const [cfg, session] = await Promise.all([
        ctx.sdk.config.get(),
        ctx.sdk.session.get({ sessionID: ctx.sessionId }).catch(() => undefined),
      ])
      const current = session?.data?.model
        ? `${session.data.model.providerID}/${session.data.model.id}`
        : (cfg.data?.model ?? "default")

      const listRes = await ctx.sdk.v2.model.list()
      const models = (listRes.data?.data ?? []).filter(m => m.enabled !== false && m.capabilities?.tools === true)

      const choices = models.map(m => ({
        label: `${m.providerID}/${m.id}${m.name ? ` (${m.name})` : ""}${`${m.providerID}/${m.id}` === current ? "  ✓" : ""}`,
        value: `${m.providerID}/${m.id}`,
      }))

      if (choices.length === 0) {
        console.log(`当前模型: ${current}\n（无可用模型列表）`)
        return "continue"
      }

      console.log(`当前模型: ${current}`)
      const chosen = await selectFromList(`选择模型（共 ${choices.length} 个）`, choices.slice(0, 80))
      if (!chosen) { console.log("已取消"); return "continue" }

      const parsed = parseModelInput(chosen)
      if (!parsed) return "continue"

      const result = await ctx.sdk.v2.session.switchModel({
        sessionID: ctx.sessionId,
        model: { providerID: parsed.providerID, id: parsed.modelID, variant: ctx.input.variant },
      })
      if (result.error) UI.error(JSON.stringify(result.error))
      else {
        console.log(`已切换到模型: ${parsed.providerID}/${parsed.modelID}`)
        ctx.input.model = `${parsed.providerID}/${parsed.modelID}`
      }
    } catch (e) {
      UI.error(String(e))
    }
    return "continue"
  }

  const parsed = parseModelInput(modelArg)
  if (!parsed) {
    UI.error("模型格式无效，请使用 provider/model 格式")
    return "continue"
  }

  try {
    const result = await ctx.sdk.v2.session.switchModel({
      sessionID: ctx.sessionId,
      model: { providerID: parsed.providerID, id: parsed.modelID, variant: ctx.input.variant },
    })
    if (result.error) UI.error(JSON.stringify(result.error))
    else {
      console.log(`已切换到模型: ${parsed.providerID}/${parsed.modelID}`)
      ctx.input.model = `${parsed.providerID}/${parsed.modelID}`
    }
  } catch (e) {
    UI.error(String(e))
  }
  return "continue"
}, ["models", "mo"])

// /variant
registerBuiltinCommand("variant", async (ctx, args) => {
  try {
    const session = await ctx.sdk.session.get({ sessionID: ctx.sessionId })
    const current = session.data?.model
    if (!current) {
      UI.error("当前会话未设置显式模型，无法查看/切换变体")
      return "continue"
    }

    const listRes = await ctx.sdk.v2.model.list()
    const info = (listRes.data?.data ?? []).find(m => m.providerID === current.providerID && m.id === current.id)
    const variants = (info?.variants ?? []).map(v => v.id)
    const currentVariant = current.variant && current.variant !== "default" ? current.variant : undefined

    const applyVariant = async (variant: string | undefined) => {
      const result = await ctx.sdk.v2.session.switchModel({
        sessionID: ctx.sessionId,
        model: { providerID: current.providerID, id: current.id, variant },
      })
      if (result.error) UI.error(JSON.stringify(result.error))
      else {
        console.log(`已切换变体: ${variant ?? "默认"}`)
        ctx.input.variant = variant
      }
    }

    if (!args.trim()) {
      if (variants.length === 0) {
        console.log(`模型 ${current.providerID}/${current.id} 无可用变体（当前: ${currentVariant ?? "默认"}）`)
        return "continue"
      }
      const choices = [
        { label: `默认${currentVariant ? "" : "  ✓"}`, value: "" },
        ...variants.map(v => ({ label: `${v}${v === currentVariant ? "  ✓" : ""}`, value: v })),
      ]
      const chosen = await selectFromList(`选择变体（当前: ${currentVariant ?? "默认"}）`, choices)
      if (chosen === undefined) { console.log("已取消"); return "continue" }
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
    UI.error(String(e))
  }
  return "continue"
})

// /agent
registerBuiltinCommand("agent", async (ctx, args) => {
  if (!args.trim()) {
    try {
      const session = await ctx.sdk.session.get({ sessionID: ctx.sessionId })
      const currentAgent = session.data?.agent ?? "build"
      console.log(`当前 agent: ${currentAgent}`)

      const listRes = await ctx.sdk.v2.agent.list()
      const agents = (listRes.data?.data ?? []).filter(a => !a.hidden)
      const choices = agents.map(a => ({
        label: `${a.id}${a.description ? ` — ${a.description}` : ""}${a.id === currentAgent ? "  ✓" : ""}`,
        value: a.id,
      }))

      if (choices.length > 0) {
        const chosen = await selectFromList("选择 agent", choices)
        if (chosen && chosen !== currentAgent) {
          const result = await ctx.sdk.v2.session.switchAgent({ sessionID: ctx.sessionId, agent: chosen })
          if (result.error) UI.error(JSON.stringify(result.error))
          else console.log(`已切换到 agent: ${chosen}`)
        } else if (chosen) {
          console.log("未变化")
        } else {
          console.log("已取消")
        }
      }
    } catch (e) {
      UI.error(String(e))
    }
    return "continue"
  }

  try {
    const result = await ctx.sdk.v2.session.switchAgent({ sessionID: ctx.sessionId, agent: args.trim() })
    if (result.error) UI.error(JSON.stringify(result.error))
    else console.log(`已切换到 agent: ${args.trim()}`)
  } catch (e) {
    UI.error(String(e))
  }
  return "continue"
})

// /status
registerBuiltinCommand("status", async (ctx) => {
  try {
    const [cfg, session] = await Promise.all([
      ctx.sdk.config.get(),
      ctx.sdk.session.get({ sessionID: ctx.sessionId }),
    ])
    const data = session.data
    if (!data) { UI.error("无法读取会话状态"); return "continue" }

    const model = data.model
      ? `${data.model.providerID}/${data.model.id}${data.model.variant && data.model.variant !== "default" ? ` (${data.model.variant})` : ""}`
      : (cfg.data?.model ?? "default")

    console.log([
      `版本:   ${data.version}`,
      `会话:   ${data.id.slice(0, 8)}`,
      `模型:   ${model}`,
      `agent:  ${data.agent ?? "build"}`,
      `标题:   ${data.title || "(未命名)"}`,
      `目录:   ${data.directory}`,
    ].join("\n"))
  } catch (e) {
    UI.error(String(e))
  }
  return "continue"
})

// /cost
registerBuiltinCommand("cost", async (ctx) => {
  try {
    const session = await ctx.sdk.session.get({ sessionID: ctx.sessionId })
    const data = session.data
    if (!data) { UI.error("无法读取会话成本"); return "continue" }

    const t = data.tokens
    const tokens = t
      ? `输入 ${t.input} · 输出 ${t.output} · 推理 ${t.reasoning} · 缓存读 ${t.cache.read} / 写 ${t.cache.write}`
      : "无 token 统计"
    const cost = data.cost !== undefined ? `$${(data.cost / 1000).toFixed(4)}` : "无成本统计"
    console.log(`Token: ${tokens}\n成本: ${cost}`)
  } catch (e) {
    UI.error(String(e))
  }
  return "continue"
})

// /context
registerBuiltinCommand("context", async (ctx) => {
  try {
    const [ctxRes, session] = await Promise.all([
      ctx.sdk.v2.session.context({ sessionID: ctx.sessionId }),
      ctx.sdk.session.get({ sessionID: ctx.sessionId }).catch(() => undefined),
    ])
    if (ctxRes.error) { UI.error(JSON.stringify(ctxRes.error)); return "continue" }

    const messages = ctxRes.data?.data ?? []
    const data = session?.data
    const model = data?.model
      ? `${data.model.providerID}/${data.model.id}${data.model.variant && data.model.variant !== "default" ? ` (${data.model.variant})` : ""}`
      : undefined
    const t = data?.tokens
    const tokens = t
      ? `输入 ${t.input} · 输出 ${t.output} · 推理 ${t.reasoning} · 缓存读 ${t.cache.read} / 写 ${t.cache.write}`
      : undefined
    const userCount = messages.filter(m => m.type === "user").length
    const assistantCount = messages.filter(m => m.type === "assistant").length
    const otherCount = messages.length - userCount - assistantCount

    console.log([
      `上下文：${messages.length} 条消息`,
      ...(model ? [`模型:   ${model}`] : []),
      ...(tokens ? [`Token:  ${tokens}`] : []),
      `消息:   用户 ${userCount} · 助手 ${assistantCount}${otherCount > 0 ? ` · 其他 ${otherCount}` : ""}`,
    ].join("\n"))
  } catch (e) {
    UI.error(String(e))
  }
  return "continue"
})

// /copy
registerBuiltinCommand("copy", async (ctx) => {
  try {
    const res = await ctx.sdk.session.messages({ sessionID: ctx.sessionId })
    if (res.error) { UI.error(JSON.stringify(res.error)); return "continue" }
    const messages = res.data ?? []
    const texts: string[] = []
    for (let i = messages.length - 1; i >= 0 && texts.length < 20; i--) {
      const msg = messages[i]
      if (!msg || msg.info.role !== "assistant") continue
      const text = msg.parts.filter(p => p.type === "text").map(p => (p as { text: string }).text).join("\n\n").trim()
      if (text) texts.push(text)
    }
    const content = texts.join("\n\n---\n\n")
    if (!content) { console.log("当前会话没有可复制的助手回复"); return "continue" }

    // 尝试写入剪贴板（OSC 52）
    const { writeClipboardOsc52 } = await import("../cmd/run/copy.shared")
    const copied = writeClipboardOsc52(content)
    console.log(`已复制 ${content.length} 字符 ${content.split("\n").length} 行${copied ? "" : "（终端不支持剪贴板）"}`)
  } catch (e) {
    UI.error(String(e))
  }
  return "continue"
})

// /branch
registerBuiltinCommand("branch", async (ctx) => {
  try {
    const res = await ctx.sdk.session.fork({ sessionID: ctx.sessionId })
    if (res.error) { UI.error(JSON.stringify(res.error)); return "continue" }
    const next = res.data?.id
    if (!next) { UI.error("分支创建失败"); return "continue" }
    ctx.sessionId = next
    console.log(`已分支会话：${res.data?.title ?? "(未命名)"}\n当前会话已切换到分支。原会话可用 /continue 恢复。`)
  } catch (e) {
    UI.error(String(e))
  }
  return "continue"
})

// /permissions
registerBuiltinCommand("permissions", async (ctx) => {
  try {
    const session = await ctx.sdk.session.get({ sessionID: ctx.sessionId })
    const rules = session.data?.permission
    if (!rules || rules.length === 0) {
      console.log("当前会话无权限规则（使用默认权限）")
    } else {
      console.log("当前会话权限:\n" + rules.map(r => `  ${r.permission} ${r.action} ${r.pattern ?? "*"}`).join("\n"))
    }
  } catch (e) {
    UI.error(String(e))
  }
  return "continue"
}, ["perms"])

// /editor
registerBuiltinCommand("editor", async (ctx) => {
  try {
    const { tmpdir } = await import("os")
    const { spawnSync } = await import("node:child_process")
    const editor = process.env.EDITOR || process.env.VISUAL
    if (!editor) {
      console.log("未检测到编辑器。请设置 EDITOR 环境变量（Windows 示例：`set EDITOR=code --wait`）")
      return "continue"
    }
    if (/[;&|`$()<>\n]/.test(editor)) {
      console.log("EDITOR 含不支持的 shell 元字符，已拒绝执行")
      return "continue"
    }

    const tmpFile = path.join(tmpdir(), `gyc-editor-${Date.now()}.md`)
    const result = spawnSync(editor, [tmpFile], { stdio: "inherit", shell: true })
    if (result.status !== 0) { UI.error(`编辑器退出码 ${result.status ?? "unknown"}`); return "continue" }

    const { Filesystem } = await import("@/util/filesystem")
    const content = await Filesystem.readText(tmpFile).catch(() => "")
    try { const { unlink } = await import("node:fs/promises"); await unlink(tmpFile) } catch {}

    if (!content.trim()) { console.log("编辑器内容为空，已取消"); return "continue" }

    // 执行这一轮对话
    await executeTurn(ctx, content.trim())
  } catch (e) {
    UI.error(String(e))
  }
  return "continue"
})

// /subagents
registerBuiltinCommand("subagents", async (ctx) => {
  if (ctx.subagents.length === 0) {
    console.log("当前会话暂无子代理运行记录")
  } else {
    console.log("最近子代理（task 工具）:")
    for (const item of ctx.subagents.slice(-20).reverse()) {
      const mark = item.status === "running" ? "•" : item.status === "completed" ? "✓" : "✗"
      console.log(`  ${mark} ${item.type}${item.description ? ` — ${item.description}` : ""} [${item.status}] ${item.at}`)
    }
  }
  return "continue"
})

// /thinking
registerBuiltinCommand("thinking", async (ctx) => {
  ctx.input.thinking = !ctx.input.thinking
  console.log(`思考块显示：${ctx.input.thinking ? "开" : "关"}`)
  return "continue"
})

// /env
registerBuiltinCommand("env", async (ctx) => {
  const { InstallationVersion } = await import("@gyccode/core/installation/version")
  console.log([
    `版本:   GycCode v${InstallationVersion}`,
    `平台:   ${process.platform}（${process.arch}）`,
    `运行时: ${typeof Bun !== "undefined" ? `Bun ${Bun.version}` : `Node ${process.version}`}`,
    `目录:   ${ctx.directory}`,
    `会话:   ${ctx.sessionId.slice(0, 8)}`,
  ].join("\n"))
  return "continue"
})

// /history - 历史搜索
registerBuiltinCommand("history", async (ctx, args) => {
  const query = args.trim()
  const results = await ctx.history.search(query, 20)
  if (results.length === 0) {
    console.log(query ? `未找到匹配: ${query}` : "历史记录为空")
    return "continue"
  }

  console.log(`找到 ${results.length} 条记录:`)
  for (const { entry } of results) {
    const time = new Date(entry.timestamp).toLocaleTimeString()
    const typeIcon = entry.type === "user" ? "👤" : entry.type === "command" ? "⚡" : "🔧"
    console.log(`  ${typeIcon} [${time}] ${entry.text.slice(0, 100)}${entry.text.length > 100 ? "..." : ""}`)
  }
  return "continue"
}, ["hist"])



async function selectFromList(title: string, items: Array<{ label: string; value: string }>): Promise<string | undefined> {
  if (items.length === 0) return undefined
  let index = 0
  const DIM = TokyoNight.textMuted
  const BOLD = Typography.bold
  const RESET = Typography.reset + TokyoNight.text
  const stdin = process.stdin

  const render = () => {
    process.stdout.write("\r\x1b[K" + title + "\n")
    items.forEach((item, i) => {
      const marker = i === index ? BOLD + "›" + RESET : " "
      const num = String(i + 1).padStart(2, " ")
      process.stdout.write(`\x1b[K  ${marker} ${DIM}${num}${RESET}  ${item.label}\n`)
    })
    process.stdout.write(`\x1b[K  输入编号或 ↑/↓ 选择，Enter 确认，Esc 取消\n`)
    process.stdout.write("\x1b[" + (items.length + 1) + "A")
  }

  return new Promise((resolve) => {
    const finish = (value: string | undefined) => {
      stdin.removeAllListeners("data")
      stdin.setRawMode(false)
      stdin.pause()
      process.stdout.write("\r\x1b[J")
      resolve(value)
    }

    stdin.setRawMode(true)
    stdin.resume()
    stdin.on("data", (chunk) => {
      const bytes = typeof chunk === "string" ? Buffer.from(chunk, "utf8") : chunk
      const str = bytes.toString("utf8")
      if (str === "\x1b[A" || str === "\x1bOA") { index = (index - 1 + items.length) % items.length; render(); return }
      if (str === "\x1b[B" || str === "\x1bOB") { index = (index + 1) % items.length; render(); return }
      if (str.startsWith("\x1b")) { finish(undefined); return }
      for (const byte of bytes) {
        const ch = byte as number
        if (ch === 3) { finish(undefined); return }
        else if (ch === 13 || ch === 10) { finish(items[index]?.value); return }
        else if (ch >= 48 && ch <= 57) { const n = ch - 48; if (n >= 1 && n <= items.length) { index = n - 1; render(); } }
      }
    })
    render()
  })
}

// 执行一轮对话（复用 pipeline）
async function executeTurn(ctx: ExecutorContext, text: string): Promise<void> {
  const fileParts = await resolveFileParts(ctx.input.files ?? [], ctx.directory, { skipMissing: true })
  const { streamLoop } = await import("../cmd/run/stream-cli")

  const events = await ctx.sdk.event.subscribe()
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
    model: model ? { providerID: model.providerID, modelID: model.modelID, variant: model.variant ?? ctx.input.variant } as { providerID: string; modelID: string; variant?: string } : undefined,
    agent: ctx.input.agent,
    variant: ctx.input.variant,
    parts: [...fileParts, { type: "text" as const, text }],
  })
  if (result.error) { UI.error(JSON.stringify(result.error)); return }
  await completed
}



const HELP_TEXT = [
  "gyc 纯 CLI 交互模式",
  "",
  "  直接输入问题并回车，逐轮对话（同一会话内保持上下文）。",
  "  斜杠命令：输入 / 弹出命令菜单（↑/↓ 选择、Tab 补全、Enter 执行、Esc 关闭）。",
  "  Ctrl+P 打开命令面板（全量命令过滤选择）。",
  "  Ctrl+R 搜索历史（模糊匹配）。",
  "",
  "  常用命令：",
  "    /new /clear         开启全新会话",
  "    /sessions /continue 继续会话（无参数时列出最近 10 个供选择）",
  "    /compact            压缩当前会话上下文",
  "    /model /models      查看或切换模型",
  "    /variant            查看或切换模型变体",
  "    /agent              查看或切换 agent",
  "    /status             显示版本/模型/会话/目录信息",
  "    /cost               显示当前会话 token 用量与成本",
  "    /context            显示当前会话上下文消息数",
  "    /thinking           切换思考块显示",
  "    /env                显示环境信息",
  "    /copy               复制最近助手回复到剪贴板",
  "    /branch             分支当前会话并切换到新分支",
  "    /permissions        显示当前会话权限规则",
  "    /editor             在外部编辑器（$EDITOR）中编写消息",
  "    /subagents          查看最近子代理运行状态",
  "    /history            搜索历史记录",
  "  标注（仅 TUI）的命令需图形界面：输入 gyc tui 后使用。",
  "  模式切换：",
  "    gyc tui             切换到全屏 TUI（当前 CLI 退出，由 TUI 接管）",
  "",
  "  Ctrl-C 退出。",
].join("\n")