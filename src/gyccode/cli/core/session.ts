// 会话管理器 - 创建/继续/分叉/压缩/导出/搜索

import {
  type GyccodeClient,
  type SessionV2Info,
  type Message,
  type Part,
} from "@gyccode/protocol/v2"

export type SessionMessageEntry = { info: Message; parts: Array<Part> }

export interface SessionManagerOptions {
  sdk: GyccodeClient
  defaultAgent?: string
  defaultModel?: string
  defaultVariant?: string
  permissionRules?: Array<{ permission: string; action: string; pattern: string }>
}

export interface SessionSummary {
  id: string
  title: string | undefined
  agent: string | undefined
  model: string | undefined
  directory: string | undefined
  updatedAt: number
  messageCount: number
}

export class SessionManager {
  private sdk: GyccodeClient
  private defaultAgent: string
  private defaultModel?: string
  private defaultVariant?: string
  private permissionRules: Array<{ permission: string; action: string; pattern: string }>

  constructor(options: SessionManagerOptions) {
    this.sdk = options.sdk
    this.defaultAgent = options.defaultAgent ?? "build"
    this.defaultModel = options.defaultModel
    this.defaultVariant = options.defaultVariant
    this.permissionRules = options.permissionRules ?? [
      { permission: "question", action: "deny", pattern: "*" },
      { permission: "plan_enter", action: "deny", pattern: "*" },
      { permission: "plan_exit", action: "deny", pattern: "*" },
    ]
  }

  // 创建新会话
  async create(options?: {
    title?: string
    agent?: string
    model?: { providerID: string; id: string; variant?: string }
  }): Promise<{ id: string; title?: string; directory?: string } | undefined> {
    const result = await this.sdk.session.create({
      title: options?.title,
      agent: options?.agent ?? this.defaultAgent,
      model: options?.model,
      permission: this.permissionRules,
    })
    return result.data ? { id: result.data.id, title: result.data.title, directory: result.data.directory } : undefined
  }

  // 获取会话详情
  async get(sessionId: string): Promise<SessionV2Info | undefined> {
    const result = await this.sdk.session.get({ sessionID: sessionId }).catch(() => undefined)
    return result?.data
  }

  // 列出会话（按更新时间倒序）
  async list(options?: { limit?: number; parentOnly?: boolean }): Promise<SessionSummary[]> {
    const result = await this.sdk.session.list()
    let sessions = result.data ?? []

    if (options?.parentOnly) {
      sessions = sessions.filter(s => !s.parentID)
    }

    return sessions
      .sort((a, b) => (b.time?.updated ?? 0) - (a.time?.updated ?? 0))
      .slice(0, options?.limit ?? 20)
      .map(s => ({
        id: s.id,
        title: s.title,
        agent: s.agent,
        model: s.model ? `${s.model.providerID}/${s.model.id}` : undefined,
        directory: s.directory,
        updatedAt: s.time?.updated ?? 0,
        messageCount: 0, // 需要单独查询
      }))
  }

  // 继续最近的会话
  async continueRecent(): Promise<{ id: string; title?: string } | undefined> {
    const sessions = await this.list({ limit: 1, parentOnly: true })
    if (sessions.length === 0) return undefined
    return { id: sessions[0].id, title: sessions[0].title }
  }

  // 分叉会话
  async fork(sessionId: string): Promise<{ id: string; title?: string } | undefined> {
    const result = await this.sdk.session.fork({ sessionID: sessionId })
    return result.data ? { id: result.data.id, title: result.data.title } : undefined
  }

  // 压缩会话上下文
  async compact(sessionId: string): Promise<boolean> {
    const result = await this.sdk.v2.session.compact({ sessionID: sessionId })
    return !result.error
  }

  // 重命名会话
  async rename(sessionId: string, title: string): Promise<boolean> {
    const result = await this.sdk.session.rename({ sessionID: sessionId, title })
    return !result.error
  }

  // 删除会话
  async delete(sessionId: string): Promise<boolean> {
    const result = await this.sdk.session.delete({ sessionID: sessionId })
    return !result.error
  }

  // 导出会话
  async export(sessionId: string, format: "json" | "markdown" = "json"): Promise<string | undefined> {
    const result = await this.sdk.session.export({ sessionID: sessionId, format })
    return result.data?.content
  }

  // 获取会话消息
  async getMessages(sessionId: string, limit = 100): Promise<SessionMessageEntry[]> {
    const result = await this.sdk.session.messages({ sessionID: sessionId })
    const messages = result.data ?? []
    return messages.slice(-limit)
  }

  // 切换模型
  async switchModel(sessionId: string, providerID: string, modelID: string, variant?: string): Promise<boolean> {
    const result = await this.sdk.v2.session.switchModel({
      sessionID: sessionId,
      model: { providerID, id: modelID, variant },
    })
    return !result.error
  }

  // 切换 Agent
  async switchAgent(sessionId: string, agent: string): Promise<boolean> {
    const result = await this.sdk.v2.session.switchAgent({ sessionID: sessionId, agent })
    return !result.error
  }

  // 获取会话权限
  async getPermissions(sessionId: string): Promise<Array<{ permission: string; action: string; pattern: string }> | undefined> {
    const result = await this.sdk.session.permission.list({ sessionID: sessionId })
    return result.data
  }

  // 设置会话权限
  async setPermissions(sessionId: string, rules: Array<{ permission: string; action: string; pattern: string }>): Promise<boolean> {
    const result = await this.sdk.session.permission.update({ sessionID: sessionId, rules })
    return !result.error
  }

  // 搜索会话（全文搜索标题/内容）
  async search(query: string, limit = 10): Promise<SessionSummary[]> {
    // 通过列表过滤（简单实现，生产环境应用服务端搜索）
    const all = await this.list({ limit: 100 })
    const lowerQuery = query.toLowerCase()
    return all
      .filter(s =>
        s.title?.toLowerCase().includes(lowerQuery) ||
        s.agent?.toLowerCase().includes(lowerQuery) ||
        s.model?.toLowerCase().includes(lowerQuery)
      )
      .slice(0, limit)
  }
}

// 交互式会话选择器
export async function selectSession(
  manager: SessionManager,
  prompt = "选择会话"
): Promise<string | undefined> {
  const sessions = await manager.list({ limit: 20 })
  if (sessions.length === 0) {
    console.log("没有可用的会话")
    return undefined
  }

  console.log(prompt + ":")
  sessions.forEach((s, i) => {
    const time = new Date(s.updatedAt).toLocaleString()
    const title = s.title || "(未命名)"
    const agent = s.agent ? ` [${s.agent}]` : ""
    const model = s.model ? ` ${s.model}` : ""
    console.log(`  ${i + 1}. ${title}${agent}${model} - ${time} (${s.id.slice(0, 8)})`)
  })

  const { createInterface } = await import("node:readline/promises")
  const rl = createInterface({ input: process.stdin, output: process.stdout })
  try {
    const answer = await rl.question("输入编号 (回车取消): ")
    const idx = parseInt(answer.trim(), 10) - 1
    if (idx >= 0 && idx < sessions.length) {
      return sessions[idx].id
    }
    return undefined
  } finally {
    rl.close()
  }
}