import type { SessionItem } from "../client/useSessions"

function relativeTime(created?: number): string {
  if (!created) return ""
  const diff = Date.now() - created
  const min = Math.floor(diff / 60000)
  if (min < 1) return "刚刚"
  if (min < 60) return `${min} 分钟前`
  const hr = Math.floor(min / 60)
  if (hr < 24) return `${hr} 小时前`
  return `${Math.floor(hr / 24)} 天前`
}

export function SessionList({
  sessions,
  selected,
  busyMap,
  pendingMap,
  onSelect,
  onNew,
  onDelete,
}: {
  sessions: SessionItem[]
  selected: string | null
  busyMap?: Record<string, boolean>
  pendingMap?: Record<string, "permission" | "question" | undefined>
  onSelect: (id: string) => void
  onNew: () => void
  onDelete: (id: string) => void
}) {
  return (
    <div>
      {sessions.length === 0 ? (
        <div style={{ padding: "8px 10px", fontSize: 12, color: "var(--inactive)" }}>暂无会话</div>
      ) : (
        sessions.map((s) => {
          const busy = busyMap?.[s.id] === true
          const pending = pendingMap?.[s.id]
          // 待交互琥珀点优先于运行蓝点（对齐 DSH 优先级约定）
          const stateLabel = pending === "permission" ? "等待审批" : pending === "question" ? "等待回答" : busy ? "运行中" : ""
          return (
            <div
              key={s.id}
              className={`sidebar-item${s.id === selected ? " active" : ""}`}
              onClick={() => onSelect(s.id)}
              style={{ flexDirection: "column", alignItems: "flex-start", gap: 2 }}
            >
              <span style={{ display: "flex", alignItems: "center", width: "100%" }}>
                <span
                  className={
                    pending
                      ? "session-dot session-dot-pending"
                      : busy
                        ? "session-dot session-dot-busy"
                        : "session-dot session-dot-idle"
                  }
                  aria-hidden
                />
                <span style={{ color: "inherit", overflow: "hidden", textOverflow: "ellipsis", flex: 1 }}>
                  {s.title ?? s.id.slice(0, 12)}
                </span>
                <button
                  className="btn btn-ghost"
                  title="删除会话"
                  onClick={(e) => {
                    e.stopPropagation()
                    onDelete(s.id)
                  }}
                  style={{ padding: "0 6px", fontSize: 14, lineHeight: 1, color: "var(--error)" }}
                >
                  ×
                </button>
              </span>
              {s.id !== selected ? (
                <span style={{ fontSize: 11, color: "var(--inactive)", paddingLeft: 14 }}>
                  {stateLabel || relativeTime(s.time?.created)}
                </span>
              ) : null}
            </div>
          )
        })
      )}
    </div>
  )
}
