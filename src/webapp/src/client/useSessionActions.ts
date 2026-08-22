import { useCallback } from "react"
import { sdk } from "./sdk"
import { v2 } from "./v2"

// 会话操作：会话管理能力。
export function useSessionActions(directory?: string) {
  const rename = useCallback(
    async (id: string, title: string) => {
      await sdk(directory).session.update({ path: { id }, body: { title } })
    },
    [directory],
  )

  const fork = useCallback(
    async (id: string) => {
      const res = await sdk(directory).session.fork({ path: { id } })
      return (res.data as { id: string } | undefined)?.id
    },
    [directory],
  )

  const remove = useCallback(
    async (id: string) => {
      await sdk(directory).session.delete({ path: { id } })
    },
    [directory],
  )

  const abort = useCallback(
    async (id: string) => {
      await sdk(directory).session.abort({ path: { id } })
    },
    [directory],
  )

  // v1 summarize 的 providerID/modelID 为必填（生成摘要所用模型），与 TUI 行为一致传当前模型。
  const summarize = useCallback(
    async (id: string, model: { providerID: string; modelID: string }) => {
      await sdk(directory).session.summarize({
        path: { id },
        body: { providerID: model.providerID, modelID: model.modelID },
      })
    },
    [directory],
  )

  // 压缩会话上下文：与 TUI/CLI 三端一致，走 v1 session.summarize 生成摘要后截断。
  // （v2 session.compact 服务端未实现，返回 OperationUnavailableError。）
  const compact = useCallback(
    async (id: string, model?: { providerID: string; modelID: string }) => {
      await sdk(directory).session.summarize({
        path: { id },
        ...(model ? { body: { providerID: model.providerID, modelID: model.modelID } } : {}),
      })
    },
    [directory],
  )

  const revert = useCallback(
    async (id: string, messageID: string) => {
      await sdk(directory).session.revert({ path: { id }, body: { messageID } })
    },
    [directory],
  )

  // 发送斜杠命令到会话（服务端执行，覆盖 /model /compact /clear /status 等）
  const command = useCallback(
    async (id: string, command: string, arguments_ = "") => {
      await sdk(directory).session.command({ path: { id }, body: { command, arguments: arguments_ } })
    },
    [directory],
  )

  // 切换会话 agent（模式：build / plan / compose），走 v2 switchAgent
  const switchAgent = useCallback(
    async (id: string, agent: string) => {
      await v2(directory).v2.session.switchAgent({ sessionID: id, agent })
    },
    [directory],
  )

  // 后台化阻塞子代理（detach 后继续后台运行），走 v2 experimental.session.background
  const background = useCallback(
    async (id: string) => {
      await v2(directory).experimental.session.background({ sessionID: id })
    },
    [directory],
  )

  // 切换会话模型，走 v2 switchModel
  const switchModel = useCallback(
    async (id: string, providerID: string, modelID: string, variant?: string) => {
      await v2(directory).v2.session.switchModel({
        sessionID: id,
        model: { providerID, id: modelID, ...(variant ? { variant } : {}) },
      })
    },
    [directory],
  )

  return { rename, fork, remove, abort, summarize, compact, revert, command, switchAgent, switchModel, background }
}

