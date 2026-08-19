import { useCallback, useEffect, useState } from "react"
import { sdk } from "./sdk"

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
      setSessions((res.data as SessionItem[]) ?? [])
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setLoading(false)
    }
  }, [directory])

  // 删除历史会话
  const remove = useCallback(
    async (id: string) => {
      await sdk(directory).session.delete({ path: { id } })
      await reload()
    },
    [reload, directory],
  )

  useEffect(() => {
    void reload()
  }, [reload])

  return { sessions, loading, error, reload, remove }
}
