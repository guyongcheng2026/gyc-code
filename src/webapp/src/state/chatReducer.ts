export type ToolState =
  | { status: "pending"; input: Record<string, unknown>; time: { start: number } }
  | { status: "running"; input: Record<string, unknown>; title?: string; time: { start: number } }
  | {
      status: "completed"
      input: Record<string, unknown>
      output: string
      title: string
      time: { start: number; end: number }
    }
  | { status: "error"; input: Record<string, unknown>; error: string; time: { start: number; end: number } }

export type ChatPart = {
  id: string
  type: string
  text?: string
  tool?: string
  callID?: string
  title?: string
  state?: ToolState
  output?: string
  error?: string
  reason?: string
  prompt?: string
  description?: string
}

export type ChatMessage = {
  id: string
  role: "user" | "assistant"
  parts: ChatPart[]
  error?: unknown
}

export type ChatState = {
  sessionID: string | null
  messages: ChatMessage[]
  idle: boolean
  busy: boolean
}

export const initialChatState = (): ChatState => ({ sessionID: null, messages: [], idle: true, busy: false })

type PartPayload = {
  id: string
  type: string
  text?: string
  tool?: string
  callID?: string
  title?: string
  state?: ToolState
  output?: string
  error?: string
  reason?: string
  prompt?: string
  description?: string
  sessionID?: string
  messageID?: string
}

type ChatAction =
  | { type: "message.updated"; properties: { info: ChatMessage } }
  | { type: "message.part.updated"; properties: { part: PartPayload; delta?: string } }
  | { type: "message.part.removed"; properties: { sessionID: string; messageID: string; partID: string } }
  | { type: "message.removed"; properties: { sessionID: string; messageID: string } }
  | { type: "session.idle"; properties: { sessionID: string } }
  | { type: "session.busy"; properties: { sessionID: string } }
  | { type: "hydrate"; messages: ChatMessage[]; sessionID: string }

export function chatReducer(state: ChatState, action: ChatAction): ChatState {
  switch (action.type) {
    case "hydrate":
      return { ...state, sessionID: action.sessionID, messages: action.messages, idle: true, busy: false }
    case "message.updated": {
      const info = action.properties.info
      const exists = state.messages.some((m) => m.id === info.id)
      const messages = exists
        ? state.messages.map((m) => (m.id === info.id ? { ...m, error: info.error, role: info.role } : m))
        : [...state.messages, { id: info.id, role: info.role, parts: [], error: info.error }]
      return { ...state, messages }
    }
    case "message.part.updated": {
      const part = action.properties.part
      const messageID = part.messageID
      if (!messageID) return state
      const delta = action.properties.delta ?? ""
      const messages = state.messages.map((m) => {
        if (m.id !== messageID) return m
        const existing = m.parts.find((p) => p.id === part.id)
        // 保留工具/步骤等字段（非文本部分在流式更新时仅更新字段本身）
        const meta: Partial<ChatPart> = {
          tool: part.tool,
          callID: part.callID,
          title: part.title,
          state: part.state,
          output: part.output,
          error: part.error,
          reason: part.reason,
          prompt: part.prompt,
          description: part.description,
        }
        const nextPart: ChatPart = existing
          ? { ...existing, ...meta, text: part.type === "text" ? (existing.text ?? "") + delta : part.text }
          : {
              id: part.id,
              type: part.type,
              text: part.type === "text" ? (part.text ?? "") + delta : part.text,
              ...meta,
            }
        const parts = existing ? m.parts.map((p) => (p.id === part.id ? nextPart : p)) : [...m.parts, nextPart]
        return { ...m, parts }
      })
      return { ...state, messages }
    }
    case "message.part.removed":
      return {
        ...state,
        messages: state.messages.map((m) =>
          m.id === action.properties.messageID
            ? { ...m, parts: m.parts.filter((p) => p.id !== action.properties.partID) }
            : m,
        ),
      }
    case "message.removed":
      return { ...state, messages: state.messages.filter((m) => m.id !== action.properties.messageID) }
    case "session.idle":
      return { ...state, idle: true, busy: false }
    case "session.busy":
      return { ...state, idle: false, busy: true }
    default:
      return state
  }
}
