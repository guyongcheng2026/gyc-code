export type ChatMessage = {
  id: string
  role: "user" | "assistant"
  parts: { type: string; text?: string; id?: string }[]
  error?: unknown
}

export type ChatState = {
  sessionID: string | null
  messages: ChatMessage[]
  idle: boolean
  busy: boolean
}

export const initialChatState = (): ChatState => ({ sessionID: null, messages: [], idle: true, busy: false })

type ChatAction =
  | { type: "message.updated"; properties: { info: ChatMessage } }
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
      const messages = exists ? state.messages.map((m) => (m.id === info.id ? info : m)) : [...state.messages, info]
      return { ...state, messages }
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
