import { useCallback, useEffect, useState } from "react"
import { v2 } from "./v2"

// 轨迹事件（v2 session.history 返回的 durable 事件，泛化形状）
export type TrajectoryEvent = {
  seq?: number
  id: string
  type: string
  properties?: Record<string, unknown>
  timestamp?: number
}

const PAGE_LIMIT = 100

/**
 * 会话事件记录（对齐 DSH Trajectory 的已加载窗口约定）：
 * 初始加载最近一页；loadEarlier 向前补页；hasMore 标记是否还有更早历史。
 */
export function useSessionHistory(sessionID: string | null, directory?: string) {
  const [events, setEvents] = useState<TrajectoryEvent[]>([])
  const [hasMore, setHasMore] = useState(false)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const loadLatest = useCallback(
    async (id: string) => {
      setLoading(true)
      setError(null)
      try {
        const res = await v2(directory).v2.session.history({ sessionID: id, limit: PAGE_LIMIT })
        const data = (res.data as TrajectoryEvent[] | undefined) ?? []
        setEvents(data)
        setHasMore(Boolean((res.data as unknown as { hasMore?: boolean } | undefined)?.hasMore ?? data.length >= PAGE_LIMIT))
      } catch (err) {
        setError(err instanceof Error ? err.message : String(err))
      } finally {
        setLoading(false)
      }
    },
    [directory],
  )

  // 向前补页：以当前最早事件的 seq/id 作为 after 锚点
  const loadEarlier = useCallback(async () => {
    if (!sessionID || events.length === 0) return
    const first = events[0]
    setLoading(true)
    try {
      const res = await v2(directory).v2.session.history({
        sessionID,
        limit: PAGE_LIMIT,
        after: first?.seq,
      })
      const data = (res.data as TrajectoryEvent[] | undefined) ?? []
      const known = new Set(events.map((e) => e.id))
      const fresh = data.filter((e) => !known.has(e.id))
      setEvents((prev) => [...fresh, ...prev])
      setHasMore(
        Boolean((res.data as unknown as { hasMore?: boolean } | undefined)?.hasMore ?? data.length >= PAGE_LIMIT),
      )
    } catch {
      // 补页失败保留现有窗口
    } finally {
      setLoading(false)
    }
  }, [sessionID, events, directory])

  useEffect(() => {
    if (!sessionID) {
      setEvents([])
      setHasMore(false)
      return
    }
    void loadLatest(sessionID)
  }, [sessionID, loadLatest])

  return { events, hasMore, loading, error, loadEarlier }
}
