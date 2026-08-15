// gyc 三种模式（复刻 TUI：plan / build / compose，默认 build）
export const MODES = [
  { id: "build", label: "构建", description: "默认模式：按权限配置执行工具" },
  { id: "plan", label: "计划", description: "计划模式：禁用所有编辑工具" },
  { id: "compose", label: "编排", description: "编排模式：调用内置 compose 技能编排工作流" },
] as const

export type ModeID = (typeof MODES)[number]["id"]

export function ModeSwitcher({
  current,
  disabled,
  onSelect,
}: {
  current: string
  disabled: boolean
  onSelect: (mode: ModeID) => void
}) {
  return (
    <div
      style={{
        display: "flex",
        gap: 2,
        background: "var(--panel-bg)",
        border: "1px solid var(--border)",
        borderRadius: 8,
        padding: 2,
      }}
    >
      {MODES.map((m) => {
        const active = current === m.id
        return (
          <button
            key={m.id}
            className="btn btn-ghost"
            disabled={disabled}
            title={m.description}
            onClick={() => onSelect(m.id)}
            style={{
              padding: "4px 10px",
              fontSize: 12,
              borderRadius: 6,
              background: active ? "var(--brand)" : "transparent",
              color: active ? "#fff" : "var(--inactive)",
              fontWeight: active ? 600 : 400,
              border: "none",
            }}
          >
            {m.label}
          </button>
        )
      })}
    </div>
  )
}
