import type { SessionItem } from "../client/useSessions"

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
    <aside style={{ width: 220, borderRight: "1px solid #333", padding: 8, overflowY: "auto" }}>
      <button onClick={onNew} style={{ width: "100%", marginBottom: 8 }}>
        + 新会话
      </button>
      <ul style={{ listStyle: "none", padding: 0, margin: 0 }}>
        {sessions.map((s) => (
          <li
            key={s.id}
            onClick={() => onSelect(s.id)}
            style={{
              cursor: "pointer",
              padding: 6,
              borderRadius: 4,
              background: s.id === selected ? "#2a2a2a" : "transparent",
            }}
          >
            {s.title ?? s.id.slice(0, 8)}
          </li>
        ))}
      </ul>
    </aside>
  )
}
