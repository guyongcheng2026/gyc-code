import { useCallback } from "react"
import { sdk } from "./sdk"

export type PromptPart = { type: "text"; text: string }

export function buildPromptParts(text: string): PromptPart[] {
  return [{ type: "text", text }]
}

export function useSendPrompt(sessionID: string | null, directory?: string) {
  const send = useCallback(
    async (text: string) => {
      if (!sessionID) throw new Error("未选择会话")
      const parts = buildPromptParts(text)
      await sdk(directory).session.promptAsync({
        path: { id: sessionID },
        body: { parts },
      })
    },
    [sessionID, directory],
  )
  return { send }
}
