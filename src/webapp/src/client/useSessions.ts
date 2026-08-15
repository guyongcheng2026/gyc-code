import { useCallback, useEffect, useState } from "react"
import { sdk } from "./sdk"

export type SessionItem = { id: string; title?: string | null; time?: { created: number } }

export function useSessions() {
  const [sessions, setSessions] = useState<SessionItem[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const reload = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const res = await sdk().session.list()
      setSessions((res.data as SessionItem[]) ?? [])
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    void reload()
  }, [reload])

  return { sessions, loading, error, reload }
}
