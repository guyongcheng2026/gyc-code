import { useMemo, useState } from "react"
import type { ModelOption } from "../client/useModels"

export function ModelPicker({
  models,
  current,
  currentVariant,
  loading,
  onSelect,
  onSelectVariant,
}: {
  models: ModelOption[]
  current: string
  currentVariant?: string
  loading: boolean
  onSelect: (label: string) => void
  onSelectVariant?: (variant: string | undefined) => void
}) {
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState("")

  const filtered = useMemo(() => {
    const q = query.toLowerCase()
    if (!q) return models
    return models.filter((m) => m.label.toLowerCase().includes(q) || m.modelName.toLowerCase().includes(q))
  }, [models, query])

  // 优先显示模型全名（如 "NVIDIA Nemotron ..."），找不到时回退 provider/model 标识
  const displayName = models.find((m) => m.label === current)?.modelName ?? current

  // 允许加载中打开下拉：下拉内会显示"加载中..."占位，避免按钮无任何反馈（loading 恒 true 时被守卫挡住打不开）
  const handleToggle = () => {
    setOpen((v) => !v)
  }

  return (
    <div style={{ position: "relative" }}>
      <button
        className="btn btn-ghost"
        onClick={handleToggle}
        style={{ fontSize: 12, maxWidth: 340, overflow: "hidden", opacity: loading ? 0.7 : 1 }}
        title={loading ? "模型列表加载中..." : current || "未选择模型"}
      >
        <span style={{ color: "var(--inactive)", flex: "none" }}>模型 </span>
        <span style={{ fontWeight: 600, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
          {loading ? "加载中..." : displayName || "未选择"}
        </span>
      </button>
      {open ? (
        <div
          style={{
            position: "absolute",
            top: "100%",
            right: 0,
            marginTop: 4,
            width: 320,
            background: "var(--panel-bg)",
            border: "1px solid var(--border)",
            borderRadius: 10,
            boxShadow: "0 8px 24px rgba(0,0,0,0.25)",
            zIndex: 30,
            overflow: "hidden",
          }}
        >
          <input
            className="text-input"
            placeholder="搜索模型..."
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            style={{ borderBottom: "1px solid var(--border-subtle)" }}
            autoFocus
            disabled={loading}
          />
          {current && onSelectVariant ? (() => {
            const selected = models.find((m) => m.label === current)
            if (!selected || selected.variants.length === 0) return null
            return (
              <div style={{ borderTop: "1px solid var(--border-subtle)", padding: "6px 8px" }}>
                <div style={{ fontSize: 11, color: "var(--inactive)", marginBottom: 4 }}>变体 variant</div>
                <div style={{ display: "flex", flexWrap: "wrap", gap: 4 }}>
                  {["", ...selected.variants].map((variant) => {
                    const active = (variant || "") === (currentVariant || "")
                    return (
                      <button
                        key={variant || "default"}
                        className="btn"
                        style={{
                          fontSize: 11,
                          padding: "2px 8px",
                          borderColor: active ? "var(--border)" : "var(--border-subtle)",
                          color: active ? "var(--fg)" : "var(--inactive)",
                          background: active ? "var(--selection-bg)" : "transparent",
                          fontWeight: active ? 600 : 400,
                        }}
                        onClick={() => onSelectVariant(variant || undefined)}
                      >
                        {variant || "默认"}
                      </button>
                    )
                  })}
                </div>
              </div>
            )
          })() : null}
          <div style={{ maxHeight: 320, overflowY: "auto" }}>
            {loading ? (
              <div style={{ padding: 16, color: "var(--inactive)", fontSize: 12, textAlign: "center" }}>
                模型列表加载中...
              </div>
            ) : filtered.length === 0 ? (
              <div style={{ padding: 12, color: "var(--inactive)", fontSize: 12, textAlign: "center" }}>
                {models.length === 0 ? "暂无可用模型" : "无匹配模型"}
              </div>
            ) : (
              filtered.map((m) => (
                <div
                  key={m.label}
                  onClick={() => {
                    onSelect(m.label)
                    setOpen(false)
                    setQuery("")
                  }}
                  style={{
                    padding: "7px 12px",
                    cursor: "pointer",
                    fontSize: 13,
                    background: m.label === current ? "var(--selection-bg)" : "transparent",
                  }}
                  onMouseEnter={(e) => (e.currentTarget.style.background = "var(--panel-bg-hover)")}
                  onMouseLeave={(e) =>
                    (e.currentTarget.style.background = m.label === current ? "var(--selection-bg)" : "transparent")
                  }
                >
                  <div style={{ fontWeight: 600 }}>{m.modelName}</div>
                  <div style={{ fontSize: 11, color: "var(--inactive)", fontFamily: "var(--font-mono)" }}>{m.label}</div>
                </div>
              ))
            )}
          </div>
        </div>
      ) : null}
    </div>
  )
}