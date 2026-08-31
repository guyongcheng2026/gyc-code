// 统一执行管道 - 核心抽象层
// 单轮 run / 交互 default / 附着 attach 共享同一执行逻辑

import { createGyccodeClient, type GyccodeClient, type CommandV2Info } from "@gyccode/protocol/v2"
import type { PermissionRule } from "@gyccode/protocol/v2/gen/types.gen"
import { Filesystem } from "@/util/filesystem"
import { pathToFileURL } from "url"
import path from "path"
import { readStdin } from "../../../core/util/read-stdin"
import { streamLoop } from "../cmd/run/stream-cli"

export interface PipelineInput {
  /** 用户输入文本 */
  message?: string
  /** 斜杠命令 */
  command?: string
  /** 命令参数 */
  commandArgs?: string
  /** 附件文件 */
  files?: string[]
  /** 模型规格 provider/model */
  model?: string
  /** 模型变体 */
  variant?: string
  /** Agent 名称 */
  agent?: string
  /** 是否显示思考块 */
  thinking?: boolean
  /** 自动批准权限 */
  auto?: boolean
  /** 会话 ID（继续/分叉） */
  sessionID?: string
  /** 是否继续最近会话 */
  continue?: boolean
  /** 是否分叉会话 */
  fork?: boolean
  /** 会话标题 */
  title?: string
  /** 工作目录 */
  directory?: string
  /** 远程服务器 URL (--attach) */
  attachUrl?: string
  /** 认证头 */
  attachHeaders?: Record<string, string>
  /** 输出格式 */
  format?: "default" | "json"
  /** 标准输入管道数据 */
  pipedInput?: string
}

export interface PipelineResult {
  sessionID: string
  error?: string
  exitCode: number
}

export interface SessionInfo {
  id: string
  title?: string
  directory?: string
  model?: { providerID: string; id: string; variant?: string }
  agent?: string
}

export interface ExecutionContext {
  sdk: GyccodeClient
  sessionID: string
  directory: string
  input: PipelineInput
  dynamicCommands: Map<string, CommandV2Info>
  subagents: Array<{ type: string; description?: string; status: string; at: string }>
}

// 模型输入解析
export function parseModelInput(value: string | undefined): { providerID: string; modelID: string } | undefined {
  if (!value) return undefined
  const [providerID, ...rest] = value.split("/")
  return { providerID, modelID: rest.join("/") }
}

// 文件附件解析
export async function resolveFileParts(files: string[], directory?: string, attachMode = false): Promise<Array<{ type: "file"; url: string; filename: string; mime: string }>> {
  const parts: Array<{ type: "file"; url: string; filename: string; mime: string }> = []
  for (const filePath of files) {
    const resolved = path.resolve(directory ?? process.cwd(), filePath)
    if (!(await Filesystem.exists(resolved))) {
      throw new Error(`文件不存在: ${filePath}`)
    }
    const stat = Filesystem.stat(resolved)
    const isDirectory = stat?.isDirectory() ?? false
    if (attachMode && isDirectory) {
      throw new Error(`无法附加本地目录: ${filePath}`)
    }
    const mime = isDirectory ? "application/x-directory" : "text/plain"
    parts.push({
      type: "file",
      url: attachMode ? `data:${mime};base64,` : pathToFileURL(resolved).href,
      filename: path.basename(resolved),
      mime,
    })
  }
  return parts
}

// 创建 SDK 客户端
export function createSdkClient(options: {
  baseUrl: string
  directory?: string
  fetch?: typeof fetch
  headers?: Record<string, string>
}): GyccodeClient {
  return createGyccodeClient({
    baseUrl: options.baseUrl,
    directory: options.directory,
    fetch: options.fetch,
    headers: options.headers,
  })
}

// 创建本地 SDK（内存 HTTP 服务器）
export async function createLocalSdk(directory: string): Promise<GyccodeClient> {
  const { Server } = await import("@/server/server")
  const { ServerAuth } = await import("@/server/auth")
  const fetchFn = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const request = new Request(input, init)
    const headers = new Headers(request.headers)
    const auth = ServerAuth.header()
    if (auth) headers.set("Authorization", auth)
    return Server.Default().app.fetch(new Request(request, { headers }))
  }) as typeof globalThis.fetch
  return createGyccodeClient({ baseUrl: "http://gyccode.internal", fetch: fetchFn, directory })
}

// 获取动态命令列表
export async function fetchDynamicCommands(sdk: GyccodeClient, directory: string): Promise<Map<string, CommandV2Info>> {
  const commands = new Map<string, CommandV2Info>()
  try {
    const res = await sdk.v2.command.list({ location: { directory } })
    for (const item of res.data?.data ?? []) {
      if (item.name && (item as { source?: string }).source !== "skill") {
        commands.set(item.name, item)
      }
    }
  } catch {}
  return commands
}

// 会话管理
export async function resolveSession(sdk: GyccodeClient, input: PipelineInput): Promise<SessionInfo | undefined> {
  const { sessionID, continue: cont, fork } = input

  if (sessionID) {
    const current = await sdk.session.get({ sessionID }).catch(() => undefined)
    if (!current?.data) throw new Error("Session not found")
    let targetID = current.data.id
    if (fork) {
      const forked = await sdk.session.fork({ sessionID })
      targetID = forked.data?.id ?? current.data.id
    }
    return { id: targetID, title: current.data.title, directory: current.data.directory, model: current.data.model, agent: current.data.agent }
  }

  if (cont) {
    const list = await sdk.session.list()
    const sessions = list.data ?? []
    const base = sessions.find(item => !item.parentID)
    if (!base) return undefined
    const baseSession = base!
    let targetID = baseSession.id
    if (fork) {
      const forked = await sdk.session.fork({ sessionID: baseSession.id })
      targetID = forked.data?.id ?? baseSession.id
    }
    return { id: targetID, title: baseSession.title, directory: baseSession.directory }
  }

  // 新建会话
  const permissionRules: PermissionRule[] = [
    { permission: "question", action: "deny" as const, pattern: "*" },
    { permission: "plan_enter", action: "deny" as const, pattern: "*" },
    { permission: "plan_exit", action: "deny" as const, pattern: "*" },
  ]
  const model: { providerID: string; modelID: string; variant?: string } | undefined = parseModelInput(input.model)
  const modelConfig = model ? { id: model.modelID, providerID: model.providerID, variant: (model.variant ?? input.variant) } : undefined
  const created = await sdk.session.create({
    title: input.title,
    agent: input.agent,
    model: modelConfig,
    permission: permissionRules,
  })
  const id = created.data?.id
  if (!id) {
    throw new Error(`Failed to create session: ${created.error ? JSON.stringify(created.error) : "未知错误（无返回数据）"}`)
  }
  return { id, title: created.data?.title ?? "", directory: created.data?.directory }
}

// 执行单轮对话或命令
export async function executeTurn(ctx: ExecutionContext): Promise<string | undefined> {
  const { sdk, sessionID, input, dynamicCommands, subagents } = ctx

  const events = await sdk.event.subscribe()
  const completed = streamLoop({
    client: sdk,
    events,
    sessionID,
    format: input.format === "json" ? "json" : "default",
    thinking: input.thinking ?? false,
    auto: input.auto ?? false,
    question: {
      reply: (requestID, answers) => sdk.v2.session.question.reply({ sessionID, requestID, questionV2Reply: { answers } }),
      reject: (requestID) => sdk.v2.session.question.reject({ sessionID, requestID }),
    },
    onSubagent: (info) => {
      subagents.push({ ...info, at: new Date().toLocaleTimeString() })
      if (subagents.length > 100) subagents.splice(0, subagents.length - 100)
    },
  }).catch((e) => {
    console.error(e)
    process.exitCode = 1
  })

  if (input.command) {
    const dynamic = dynamicCommands.get(input.command)
    if (dynamic) {
      const result = await sdk.session.command({ sessionID, command: dynamic.name, arguments: input.commandArgs })
      if (result.error) throw new Error(JSON.stringify(result.error))
      await completed
      return undefined
    }
    // 内置命令由调用方处理
    return "builtin"
  }

  const fileParts = await resolveFileParts(input.files ?? [], input.directory, !!input.attachUrl)
  const model = parseModelInput(input.model)
  const result = await sdk.session.prompt({
    sessionID,
    model: model ? { providerID: model.providerID, modelID: model.modelID } : undefined,
    agent: input.agent,
    variant: input.variant,
    parts: [...fileParts, { type: "text", text: input.message ?? "" }],
  })
  if (result.error) throw new Error(JSON.stringify(result.error))
  await completed
  return undefined
}

// 统一执行入口
export async function runPipeline(input: PipelineInput): Promise<PipelineResult> {
  // 解析管道输入
  const piped = input.pipedInput ?? (process.stdin.isTTY ? undefined : await readStdin())
  const message = [input.message, piped].filter(Boolean).join("\n")

  if (!message?.trim() && !input.command) {
    return { sessionID: "", error: "You must provide a message or a command", exitCode: 1 }
  }

  // 确定 SDK
  let sdk: GyccodeClient
  let directory = input.directory ?? process.cwd()
  let cleanup: (() => void) | undefined

  if (input.attachUrl) {
    sdk = createSdkClient({ baseUrl: input.attachUrl, directory, headers: input.attachHeaders })
  } else {
    sdk = await createLocalSdk(directory)
  }

  try {
    // 获取动态命令
    const dynamicCommands = await fetchDynamicCommands(sdk, directory)

    // 解析会话
    const session = await resolveSession(sdk, { ...input, message })
    if (!session) return { sessionID: "", error: "Failed to resolve session", exitCode: 1 }

    // 执行
    const ctx: ExecutionContext = {
      sdk,
      sessionID: session.id,
      directory,
      input: { ...input, message },
      dynamicCommands,
      subagents: [],
    }

    await executeTurn(ctx)
    return { sessionID: session.id, exitCode: (process.exitCode ?? 0) as number }
  } finally {
    cleanup?.()
  }
}