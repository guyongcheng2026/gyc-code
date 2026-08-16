import { useCallback } from "react"
import { sdk } from "./sdk"

export type PromptFile = { url: string; filename?: string; mime?: string }
export type PromptPart =
  | { type: "text"; text: string }
  | { type: "file"; url: string; filename?: string; mime?: string }
export type SendModel = { providerID: string; modelID: string }

export function buildPromptParts(text: string, files: PromptFile[] = []): PromptPart[] {
  const parts: PromptPart[] = files.map((file) => ({
    type: "file",
    url: file.url,
    filename: file.filename,
    mime: file.mime ?? "text/plain",
  }))
  parts.push({ type: "text", text })
  return parts
}

export function useSendPrompt(sessionID: string | null, directory?: string) {
  // model 为可选：传入时显式指定本次发送所用模型（确保模型选择真正生效，
  // 因服务端 promptAsync 不带 model 时会回退到默认模型而非会话当前模型）
  const send = useCallback(
    async (text: string, model?: SendModel, files: PromptFile[] = []) => {
      if (!sessionID) throw new Error("未选择会话")
      const parts = buildPromptParts(text, files)
      const body: { parts: PromptPart[]; model?: SendModel } = { parts }
      if (model?.providerID && model?.modelID) body.model = model
      await sdk(directory).session.promptAsync({
        path: { id: sessionID },
        body,
      })
    },
    [sessionID, directory],
  )
  return { send }
}
