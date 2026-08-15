import { Virtuoso } from "react-virtuoso"
import type { ChatMessage } from "../state/chatReducer"

export function MessageList({ messages }: { messages: ChatMessage[] }) {
  return (
    <Virtuoso
      style={{ flex: 1, minHeight: 0 }}
      data={messages}
      followOutput="smooth"
      itemContent={(_, m) => (
        <div key={m.id} style={{ padding: "6px 12px" }}>
          <strong>{m.role === "user" ? "你" : "gyc"}</strong>
          <pre style={{ whiteSpace: "pre-wrap", fontFamily: "inherit", margin: "4px 0" }}>
            {m.parts?.map((p) => (p.type === "text" ? p.text : `[${p.type}]`)).join("")}
          </pre>
          {m.error ? <p style={{ color: "red" }}>错误: {String(m.error)}</p> : null}
        </div>
      )}
    />
  )
}
