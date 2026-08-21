import { useState } from "react"
import type { JobItem } from "../client/useJobs"

const STATUS_META: Record<JobItem["status"], { label: string; className: string }> = {
  running: { label: "运行中", className: "session-dot-busy" },
  completed: { label: "已完成", className: "session-dot-idle" },
  error: { label: "失败", className: "session-dot-error" },
  cancelled: { label: "已取消", className: "session-dot-cancelled" },
}

function relativeTime(ts?: number): string {
  if (!ts) return ""
  const diff = Math.max(0, Date.now() - ts)
  const sec = Math.floor(diff / 1000)
  if (sec < 60) return `${sec} 秒前`
  const min = Math.floor(sec / 60)
  if (min < 60) return `${min} 分钟前`
  const hr = Math.floor(min / 60)
  if (hr < 24) return `${hr} 小时前`
  return `${Math.floor(hr / 24)} 天前`
}

function duration(started_at: number, completed_at?: number): string {
  const end = completed_at ?? Date.now()
  const sec = Math.max(0, Math.floor((end - started_at) / 1000))
  if (sec < 60) return `${sec} 秒`
  const min = Math.floor(sec / 60)
  if (min < 60) return `${min} 分 ${sec % 60} 秒`
  return `${Math.floor(min / 60)} 小时 ${min % 60} 分`
}

// 后台任务面板（对齐 DSH Jobs）：展示后台子代理任务，点击选中会话，运行中可取消。
export function JobsPanel({
  jobs,
  onSelect,
  onCancel,
}: {
  jobs: JobItem[]
  onSelect: (sessionID: string) => void
  onCancel: (jobID: string) => void
}) {
  const [open, setOpen] = useState(true)
  const running = jobs.filter((job) => job.status === "running")
  const sorted = [...jobs].sort((a, b) => b.started_at - a.started_at)

  return (
    <div className="jobs-panel">
      <div className="jobs-header" onClick={() => setOpen((v) => !v)} title={open ? "收起" : "展开"}>
        <span className="jobs-title">后台任务</span>
        {running.length > 0 ? <span className="jobs-badge">{running.length}</span> : null}
        <span className="jobs-caret">{open ? "▾" : "▸"}</span>
      </div>
      {open ? (
        <div className="jobs-list">
          {sorted.length === 0 ? (
            <div className="jobs-empty">暂无后台任务</div>
          ) : (
            sorted.map((job) => {
              const meta = STATUS_META[job.status]
              const title = job.title && job.title.length > 0 ? job.title : job.id.slice(0, 12)
              return (
                <div
                  key={job.id}
                  className="jobs-item"
                  onClick={() => onSelect(job.id)}
                  title={job.status === "error" && job.error ? `${title}\n${job.error}` : title}
                >
                  <span className={`session-dot ${meta.className}`} aria-hidden />
                  <span className="jobs-item-main">
                    <span className="jobs-item-title">{title}</span>
                    <span className="jobs-item-meta">
                      {meta.label}
                      {job.status === "running"
                        ? ` · ${duration(job.started_at)}`
                        : ` · ${relativeTime(job.completed_at ?? job.started_at)}`}
                    </span>
                  </span>
                  {job.status === "running" ? (
                    <button
                      className="btn btn-ghost jobs-cancel"
                      onClick={(e) => {
                        e.stopPropagation()
                        onCancel(job.id)
                      }}
                    >
                      取消
                    </button>
                  ) : null}
                </div>
              )
            })
          )}
        </div>
      ) : null}
    </div>
  )
}
