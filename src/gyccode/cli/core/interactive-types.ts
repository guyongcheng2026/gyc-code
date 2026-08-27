// 交互式 CLI 核心类型定义

export interface InteractiveInput {
  directory?: string
  model?: string
  variant?: string
  agent?: string
  thinking?: boolean
  auto?: boolean
  files?: string[]
  sessionID?: string
  continue?: boolean
  fork?: boolean
}

export interface SlashCommandSpec {
  name: string
  aliases?: string[]
  description: string
  category: string
  tuiOnly?: boolean
  executor: "builtin" | "dynamic"
  requiresSession?: boolean
}

export interface MenuEntry {
  label: string      // 显示标签（含 /）
  fill: string       // 执行时填入的完整命令
  description: string
  aliases: string    // 模糊匹配用
  tuiOnly: boolean
  dynamic: boolean
}

export interface HistoryEntry {
  id: number
  sessionId: string
  timestamp: number
  text: string
  type: "user" | "command" | "slash"
}

export interface CompletionItem {
  label: string
  detail?: string
  insertText: string
  kind: "command" | "file" | "session" | "model" | "agent"
}

export interface KeyBinding {
  key: string
  action: string
  description: string
}