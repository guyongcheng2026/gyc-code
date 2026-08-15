import { Virtuoso } from "react-virtuoso"
import type { ChatMessage } from "../state/chatReducer"

export function MessageList({ messages }: { messages: ChatMessage[] }) {
  return (
    <Virtuoso
      style={{ flex: 1, minHeight: 0 }}
      data={messages}
      followOutput="smooth"
      itemContent={(_, m) => (
        <div
          key={m.id}
          className={`msg${m.role === "user" ? " msg-user" : ""}`}
          style={{ margin: "4px 0", lineHeight: 1.6 }}
        >
          <div style={{ fontSize: 12, fontWeight: 700, marginBottom: 4 }}>
            {m.role === "user" ? (
              <span style={{ color: "var(--inactive)" }}>你</span>
            ) : (
              <span style={{ color: "var(--claude)" }}>gyc</span>
            )}
          </div>
          <div style={{ whiteSpace: "pre-wrap", wordBreak: "break-word" }}>
            {m.parts?.map((p) => (p.type === "text" ? p.text : `[${p.type}]`)).join("") || ""}
          </div>
          {m.error ? <div style={{ color: "var(--error)", marginTop: 4 }}>错误: {String(m.error)}</div> : null}
        </div>
      )}
    />
  )
}
