import { useCallback, useEffect, useState } from "react"
import { sdk } from "./sdk"

export type FileDiff = { file: string; before: string; after: string; additions: number; deletions: number }

// 会话 diff：session.diff 返回本会话产生的文件改动（before/after 全文）。
export function useSessionDiff(sessionID: string | null, directory?: string) {
  const [diffs, setDiffs] = useState<FileDiff[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(async () => {
    if (!sessionID) return
    setLoading(true)
    setError(null)
    try {
      const res = await sdk(directory).session.diff({ path: { id: sessionID } })
      setDiffs((res.data as FileDiff[] | undefined) ?? [])
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setLoading(false)
    }
  }, [sessionID, directory])

  useEffect(() => {
    void load()
  }, [load])

  return { diffs, loading, error, reload: load }
}
