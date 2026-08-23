import { useCallback, useEffect, useState } from "react"
import { sdk } from "./sdk"
import { unwrapList } from "./useCommands"

export type SessionItem = { id: string; title?: string | null; time?: { created: number }; parentID?: string }

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

  // 删除历史会话：v1 提供 /session/{id} DELETE；v2 无 delete 端点（Session3 无该方法），删除失败时静默并刷新列表
  const remove = useCallback(
    async (id: string) => {
      try {
        await sdk(directory).session.delete({ path: { id } })
      } catch {
        // v2 无会话删除端点，忽略删除错误（reload 仍会刷新列表）
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
