import { Virtuoso } from "react-virtuoso"
import type { ChatMessage } from "../state/chatReducer"
import { PartView } from "./PartView"

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
          <div style={{ wordBreak: "break-word" }}>
            {m.parts?.map((p) => <PartView key={p.id} part={p} />) ?? ""}
          </div>
          {m.error ? <div style={{ color: "var(--error)", marginTop: 4 }}>错误: {String(m.error)}</div> : null}
        </div>
      )}
    />
  )
}
