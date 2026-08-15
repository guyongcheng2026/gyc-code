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
  onSelect,
  onNew,
}: {
  sessions: SessionItem[]
  selected: string | null
  onSelect: (id: string) => void
  onNew: () => void
}) {
  return (
    <div>
      {sessions.length === 0 ? (
        <div style={{ padding: "8px 10px", fontSize: 12, color: "var(--inactive)" }}>暂无会话</div>
      ) : (
        sessions.map((s) => (
          <div
            key={s.id}
            className={`sidebar-item${s.id === selected ? " active" : ""}`}
            onClick={() => onSelect(s.id)}
            style={{ flexDirection: "column", alignItems: "flex-start", gap: 2 }}
          >
            <span style={{ color: "inherit", overflow: "hidden", textOverflow: "ellipsis", maxWidth: "100%" }}>
              {s.title ?? s.id.slice(0, 12)}
            </span>
            {s.id !== selected ? (
              <span style={{ fontSize: 11, color: "var(--inactive)" }}>{relativeTime(s.time?.created)}</span>
            ) : null}
          </div>
        ))
      )}
    </div>
  )
}
