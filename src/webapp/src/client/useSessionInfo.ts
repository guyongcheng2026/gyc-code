import { useCallback, useEffect, useState } from "react"
import { sdk } from "./sdk"
import { useEvents, type AnyEvent } from "./useEvents"

export type SessionInfo = {
  id: string
  title?: string | null
  cost?: number
  tokens?: { input: number; output: number; reasoning: number; cache: { read: number; write: number } }
  model?: { providerID: string; modelID: string; variant?: string }
  agent?: string
  status?: string
  todos: { content: string; done?: boolean }[]
}

type SessionStatusMap = Record<string, { type: string }>

// 会话信息：cost/tokens/状态/todo，事件触发刷新。
export function useSessionInfo(sessionID: string | null, directory?: string) {
  const [info, setInfo] = useState<SessionInfo | null>(null)

  const refresh = useCallback(async () => {
    if (!sessionID) return
    const [statusRes, todoRes] = await Promise.all([
      sdk(directory).session.status(),
      sdk(directory).session.todo({ path: { id: sessionID } }).catch(() => ({ data: [] })),
    ])
    const status = (statusRes.data as SessionStatusMap | undefined)?.[sessionID]
    const todos = ((todoRes.data as { content: string; done?: boolean }[] | undefined) ?? []).map((t) => ({
      content: t.content,
      done: t.done,
    }))
    setInfo((prev) => ({
      id: sessionID,
      title: prev?.title,
      cost: prev?.cost,
      tokens: prev?.tokens,
      status: status?.type,
      todos,
    }))
  }, [sessionID, directory])

  // 会话详情（cost/tokens/title）
  useEffect(() => {
    if (!sessionID) {
      setInfo(null)
      return
    }
    void sdk(directory)
      .session.get({ path: { id: sessionID } })
      .then((res) => {
        const s = res.data as {
          title?: string
          cost?: number
          tokens?: SessionInfo["tokens"]
          model?: SessionInfo["model"]
          agent?: string
        }
        setInfo((prev) => ({
          id: sessionID,
          title: s.title ?? prev?.title,
          cost: s.cost ?? prev?.cost,
          tokens: s.tokens ?? prev?.tokens,
          model: s.model ?? prev?.model,
          agent: s.agent ?? prev?.agent,
          status: prev?.status,
          todos: prev?.todos ?? [],
        }))
      })
      .catch(() => {})
    void refresh()
  }, [sessionID, directory, refresh])

  // 会话状态/事件驱动刷新
  useEvents(directory, (e: AnyEvent) => {
    if (e.type === "session.idle" || e.type === "session.status" || e.type === "session.compacted") {
      void refresh()
    }
  })

  return { info, refresh }
}
