import type { ReactNode } from "react"
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

// 会话树（对齐 DSH sidebar 多级会话树）：按 parentID 分组，子会话（分支）
// 在父会话下缩进展示；parent 不在列表中的会话视为根。
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
  const ids = new Set(sessions.map((s) => s.id))
  const childrenOf = new Map<string, SessionItem[]>()
  const roots: SessionItem[] = []
  for (const s of sessions) {
    if (s.parentID && ids.has(s.parentID)) {
      const list = childrenOf.get(s.parentID) ?? []
      list.push(s)
      childrenOf.set(s.parentID, list)
    } else {
      roots.push(s)
    }
  }

  const renderItem = (s: SessionItem, depth: number) => {
    const busy = busyMap?.[s.id] === true
    const pending = pendingMap?.[s.id]
    const stateLabel = pending === "permission" ? "等待审批" : pending === "question" ? "等待回答" : busy ? "运行中" : ""
    return (
      <div
        key={s.id}
        className={`sidebar-item${s.id === selected ? " active" : ""}${depth > 0 ? " sidebar-item-child" : ""}`}
        onClick={() => onSelect(s.id)}
        style={{ flexDirection: "column", alignItems: "flex-start", gap: 2, paddingLeft: 8 + depth * 16 }}
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
  }

  const renderTree = (node: SessionItem, depth: number): ReactNode[] => {
    const kids = childrenOf.get(node.id) ?? []
    return [renderItem(node, depth), ...kids.map((k) => renderTree(k, depth + 1))]
  }

  return (
    <div>
      {sessions.length === 0 ? (
        <div style={{ padding: "8px 10px", fontSize: 12, color: "var(--inactive)" }}>暂无会话</div>
      ) : (
        roots.flatMap((r) => renderTree(r, 0))
      )}
    </div>
  )
}