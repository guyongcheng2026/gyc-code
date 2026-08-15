import type { ChatMessage } from "../state/chatReducer"

export function MessageList({ messages }: { messages: ChatMessage[] }) {
  return (
    <div style={{ flex: 1, overflowY: "auto", padding: 12 }}>
      {messages.map((m) => (
        <div key={m.id} style={{ marginBottom: 12 }}>
          <strong>{m.role === "user" ? "你" : "gyc"}</strong>
          <pre style={{ whiteSpace: "pre-wrap", fontFamily: "inherit" }}>
            {m.parts?.map((p) => (p.type === "text" ? p.text : `[${p.type}]`)).join("")}
          </pre>
          {m.error ? <p style={{ color: "red" }}>错误: {String(m.error)}</p> : null}
        </div>
      ))}
    </div>
  )
}
