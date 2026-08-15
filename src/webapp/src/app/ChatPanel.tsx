import { useState } from "react"
import { useChatSession } from "../client/useChatSession"
import { useSendPrompt } from "../client/useSendPrompt"
import { MessageList } from "./MessageList"
import { PromptInput } from "./PromptInput"

export function ChatPanel({ sessionID }: { sessionID: string }) {
  const { messages, busy } = useChatSession(sessionID)
  const { send } = useSendPrompt(sessionID)
  const [sendError, setSendError] = useState<string | null>(null)

  return (
    <section style={{ display: "flex", flexDirection: "column", flex: 1, minWidth: 0 }}>
      <MessageList messages={messages} />
      {sendError ? <p style={{ color: "red" }}>{sendError}</p> : null}
      <PromptInput
        disabled={busy}
        onSubmit={(text) => {
          send(text).catch((err) => setSendError(err instanceof Error ? err.message : String(err)))
        }}
      />
    </section>
  )
}
