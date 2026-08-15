import type { PermissionItem } from "../state/permissionReducer"

export function PermissionCard({
  item,
  onResolve,
}: {
  item: PermissionItem
  onResolve: (permissionID: string, allow: boolean) => void
}) {
  const pattern = Array.isArray(item.pattern) ? item.pattern.join(", ") : item.pattern
  const detail = item.metadata && "command" in item.metadata ? String(item.metadata.command) : pattern
  return (
    <div style={{ border: "1px solid #555", borderRadius: 8, padding: 12, margin: 8, background: "#1c1c1c" }}>
      <strong>{item.title}</strong>
      <p>
        工具: <code>{item.type}</code>
      </p>
      {detail ? <pre style={{ whiteSpace: "pre-wrap" }}>{detail}</pre> : null}
      <button onClick={() => onResolve(item.id, true)}>允许</button>
      <button onClick={() => onResolve(item.id, false)}>拒绝</button>
    </div>
  )
}
