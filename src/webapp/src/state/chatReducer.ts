export type ChatPart = { id: string; type: string; text?: string }

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

type PartPayload = { id: string; type: string; text?: string; sessionID?: string; messageID?: string }

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
        const nextPart: ChatPart = existing
          ? { ...existing, text: (existing.text ?? "") + delta }
          : { id: part.id, type: part.type, text: (part.text ?? "") + delta }
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
