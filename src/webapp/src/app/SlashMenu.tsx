import type { CommandItem } from "../client/useCommands"

export function SlashMenu({
  items,
  selected,
  onSelect,
  onClose,
}: {
  items: CommandItem[]
  selected: number
  onSelect: (index: number) => void
  onClose: () => void
}) {
  if (items.length === 0) return null
  return (
    <div
      style={{
        position: "absolute",
        bottom: "100%",
        left: 8,
        right: 8,
        marginBottom: 6,
        background: "var(--panel-bg)",
        border: "1px solid var(--border)",
        borderRadius: 10,
        boxShadow: "0 8px 24px rgba(0,0,0,0.25)",
        overflow: "hidden",
        zIndex: 20,
        maxHeight: 280,
        overflowY: "auto",
      }}
    >
      {items.map((c, i) => (
        <div
          key={c.name}
          onMouseEnter={() => onSelect(i)}
          onClick={() => onSelect(i)}
          style={{
            padding: "7px 12px",
            cursor: "pointer",
            background: i === selected ? "var(--selection-bg)" : "transparent",
            color: "var(--text)",
          }}
        >
          <span style={{ fontWeight: 600, marginRight: 8, fontFamily: "var(--font-mono)" }}>/{c.name}</span>
          {c.description ? (
            <span style={{ color: "var(--inactive)", fontSize: 12 }}>{c.description}</span>
          ) : null}
        </div>
      ))}
      <div
        style={{
          padding: "5px 12px",
          fontSize: 11,
          color: "var(--inactive)",
          borderTop: "1px solid var(--border-subtle)",
          display: "flex",
          gap: 12,
        }}
      >
        <span>↑↓ 选择</span>
        <span>Enter 执行</span>
        <span>Esc 关闭</span>
      </div>
    </div>
  )
}
