import { useState } from "react"
import { useChatSession } from "../client/useChatSession"
import { useSendPrompt } from "../client/useSendPrompt"
import { usePermissions } from "../client/usePermissions"
import { MessageList } from "./MessageList"
import { PromptInput } from "./PromptInput"
import { PermissionCard } from "./PermissionCard"

export function ChatPanel({ sessionID }: { sessionID: string }) {
  const { messages, busy } = useChatSession(sessionID)
  const { send } = useSendPrompt(sessionID)
  const { queue, resolve } = usePermissions(sessionID)
  const [sendError, setSendError] = useState<string | null>(null)

  return (
    <section style={{ display: "flex", flexDirection: "column", flex: 1, minWidth: 0, height: "100%" }}>
      <div style={{ flex: 1, minHeight: 0, overflowY: "auto", padding: "16px 24px" }}>
        {queue.map((p) => (
          <PermissionCard key={p.id} item={p} onResolve={resolve} />
        ))}
        <MessageList messages={messages} />
      </div>
      {sendError ? (
        <div style={{ padding: "0 24px", color: "var(--error)", fontSize: 13 }}>{sendError}</div>
      ) : null}
      <div style={{ padding: "8px 24px 16px" }}>
        <PromptInput
          disabled={busy}
          onSubmit={(text) => {
            send(text).catch((err) => setSendError(err instanceof Error ? err.message : String(err)))
          }}
        />
      </div>
    </section>
  )
}
