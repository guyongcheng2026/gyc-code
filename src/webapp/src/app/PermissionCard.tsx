import type { PermissionItem } from "../state/permissionReducer"

export function PermissionCard({
  item,
  onResolve,
}: {
  item: PermissionItem
  onResolve: (permissionID: string, response: "once" | "always" | "reject") => void
}) {
  const pattern = Array.isArray(item.pattern) ? item.pattern.join(", ") : item.pattern
  const detail = item.metadata && "command" in item.metadata ? String(item.metadata.command) : pattern
  return (
    <div className="tool-card">
      <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 6 }}>
        <span className="badge" style={{ background: "var(--permission)", color: "#1a1a1a", fontWeight: 700 }}>
          {item.type.slice(0, 1).toUpperCase()}
        </span>
        <strong style={{ fontSize: 13 }}>{item.title}</strong>
        <code style={{ color: "var(--inactive)", fontSize: 12 }}>{item.type}</code>
      </div>
      {detail ? (
        <pre
          style={{
            whiteSpace: "pre-wrap",
            fontFamily: "var(--font-mono)",
            fontSize: 12,
            color: "var(--inactive)",
            margin: "0 0 8px",
          }}
        >
          {detail}
        </pre>
      ) : null}
      <div style={{ display: "flex", gap: 8 }}>
        <button
          className="btn"
          style={{ borderColor: "var(--success)", color: "var(--success)", fontWeight: 600 }}
          onClick={() => onResolve(item.id, "once")}
        >
          允许一次
        </button>
        <button
          className="btn"
          style={{ borderColor: "var(--border)", color: "var(--success)" }}
          onClick={() => onResolve(item.id, "always")}
        >
          始终允许
        </button>
        <button
          className="btn"
          style={{ borderColor: "var(--error)", color: "var(--error)" }}
          onClick={() => onResolve(item.id, "reject")}
        >
          拒绝
        </button>
      </div>
    </div>
  )
}
