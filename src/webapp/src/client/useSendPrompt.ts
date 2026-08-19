import { useCallback } from "react"
import { sdk } from "./sdk"
import { v2 } from "./v2"

export type PromptFile = { url: string; filename?: string; mime?: string }
export type PromptPart =
  | { type: "text"; text: string }
  | { type: "file"; url: string; filename?: string; mime: string }
export type SendModel = { providerID: string; modelID: string }
// 投递方式（对齐服务端 SessionInput.Delivery）：
// - undefined：空闲发送（v1 promptAsync）
// - "queue"：运行中排队（下一轮唤醒）
// - "steer"：运行中插话（当前轮次 next-step 窗口接纳）
export type Delivery = "queue" | "steer"

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

  // 运行中投递：queue（排队到下一轮）或 steer（插入当前轮次），走 v2 session prompt。
  const deliver = useCallback(
    async (text: string, delivery: Delivery, files: PromptFile[] = []) => {
      if (!sessionID) throw new Error("未选择会话")
      await v2(directory).v2.session.prompt({
        sessionID,
        prompt: {
          text,
          files: files.map((file) => ({ uri: file.url, name: file.filename })),
        },
        delivery,
      })
    },
    [sessionID, directory],
  )

  return { send, deliver }
}
