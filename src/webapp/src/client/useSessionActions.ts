import { useCallback } from "react"
import { sdk } from "./sdk"

// 会话操作：对齐 Claude Code 的会话管理能力。
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

  const summarize = useCallback(
    async (id: string) => {
      await sdk(directory).session.summarize({ path: { id } })
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

  return { rename, fork, remove, abort, summarize, revert, command }
}
