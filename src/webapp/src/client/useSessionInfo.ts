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

// 服务端 Session.Info 的 model 字段结构（Model.Ref）：{ id, providerID, variant }。
type SessionModel = { providerID: string; id: string; variant?: string }
type SessionGetData = {
  title?: string | null
  cost?: number
  tokens?: SessionInfo["tokens"]
  model?: SessionModel
  agent?: string
}

// 服务端 model 使用 id 字段，前端使用 modelID，需映射。
function normalizeModel(m?: SessionModel): SessionInfo["model"] {
  if (!m) return undefined
  return { providerID: m.providerID, modelID: m.id, variant: m.variant }
}

// 会话信息：cost/tokens/title/model/agent/状态/todo，事件触发刷新。
// refresh 会重新拉取会话详情（含 model），确保切换模型/模式后界面及时更新。
export function useSessionInfo(sessionID: string | null, directory?: string) {
  const [info, setInfo] = useState<SessionInfo | null>(null)

  const refresh = useCallback(async () => {
    if (!sessionID) return
    const [detailRes, statusRes, todoRes] = await Promise.all([
      sdk(directory)
        .session.get({ path: { id: sessionID } })
        .catch(() => ({ data: undefined })),
      sdk(directory).session.status().catch(() => ({ data: undefined })),
      sdk(directory)
        .session.todo({ path: { id: sessionID } })
        .catch(() => ({ data: [] })),
    ])
    const detail = detailRes.data as SessionGetData | undefined
    const status = (statusRes.data as SessionStatusMap | undefined)?.[sessionID]
    const todos = ((todoRes.data as { content: string; done?: boolean }[] | undefined) ?? []).map((t) => ({
      content: t.content,
      done: t.done,
    }))
    setInfo((prev) => ({
      id: sessionID,
      title: detail?.title ?? prev?.title,
      cost: detail?.cost ?? prev?.cost,
      tokens: detail?.tokens ?? prev?.tokens,
      model: normalizeModel(detail?.model) ?? prev?.model,
      agent: detail?.agent ?? prev?.agent,
      status: status?.type,
      todos,
    }))
  }, [sessionID, directory])

  // 会话详情（cost/tokens/title/model/agent）与状态/todo，挂载时与事件驱动刷新。
  useEffect(() => {
    if (!sessionID) {
      setInfo(null)
      return
    }
    void refresh()
  }, [sessionID, refresh])

  // 会话状态事件驱动刷新
  useEvents(directory, (e: AnyEvent) => {
    if (e.type === "session.idle" || e.type === "session.status" || e.type === "session.compacted") {
      void refresh()
    }
  })

  return { info, refresh }
}
