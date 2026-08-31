import { useCallback, useEffect, useRef, useState } from "react"
import { useEvents } from "./useEvents"

export type JobStatus = "running" | "completed" | "error" | "cancelled"

export type JobItem = {
  id: string
  type: string
  title?: string
  status: JobStatus
  started_at: number
  completed_at?: number
  output?: string
  error?: string
  metadata?: Record<string, unknown>
}

const POLL_MS = 3000

// 后台任务（对齐 DSH Jobs）：轮询 /experimental/jobs 拉取后台子代理任务，并监听会话事件刷新。
export function useJobs(directory?: string) {
  const [jobs, setJobs] = useState<JobItem[]>([])
  const timer = useRef<number | undefined>(undefined)

  const reload = useCallback(() => {
    const url = directory
      ? `/experimental/jobs?directory=${encodeURIComponent(directory)}`
      : "/experimental/jobs"
    return fetch(url)
      .then((res) => (res.ok ? (res.json() as Promise<JobItem[]>) : Promise.resolve([] as JobItem[])))
      .then((data) => setJobs(data))
      .catch((e) => {
        // 任务列表拉取失败时保留上一次结果，留痕便于排查
        console.error("[useJobs] 拉取任务列表失败", e)
      })
  }, [directory])

  useEffect(() => {
    void reload()
    timer.current = window.setInterval(() => void reload(), POLL_MS)
    return () => window.clearInterval(timer.current)
  }, [reload])

  useEvents(directory, (e) => {
    if (e.type === "session.busy" || e.type === "session.idle" || e.type === "session.updated") void reload()
  })

  return { jobs, reload }
}
