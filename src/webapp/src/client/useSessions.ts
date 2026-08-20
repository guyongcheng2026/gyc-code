import { useCallback, useEffect, useState } from "react"
import { sdk } from "./sdk"
import { v2 } from "./v2"
import { unwrapList } from "./useCommands"

export type SessionItem = { id: string; title?: string | null; time?: { created: number } }

export function useSessions(directory?: string) {
  const [sessions, setSessions] = useState<SessionItem[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const reload = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const res = await sdk(directory).session.list()
      setSessions(unwrapList<SessionItem>(res.data))
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setLoading(false)
    }
  }, [directory])

  // 删除历史会话：v1 失败（路由/形状不匹配）时回退 v2 端点
  const remove = useCallback(
    async (id: string) => {
      try {
        await sdk(directory).session.delete({ path: { id } })
      } catch {
        await v2(directory).v2.session.delete({ sessionID: id })
      }
      await reload()
    },
    [reload, directory],
  )

  useEffect(() => {
    void reload()
  }, [reload])

  return { sessions, loading, error, reload, remove }
}
