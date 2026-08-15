import { useMemo, useState } from "react"
import type { ModelOption } from "../client/useModels"

export function ModelPicker({
  models,
  current,
  loading,
  onSelect,
}: {
  models: ModelOption[]
  current: string
  loading: boolean
  onSelect: (label: string) => void
}) {
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState("")
  const filtered = useMemo(() => {
    const q = query.toLowerCase()
    if (!q) return models
    return models.filter((m) => m.label.toLowerCase().includes(q) || m.modelName.toLowerCase().includes(q))
  }, [models, query])

  return (
    <div style={{ position: "relative" }}>
      <button className="btn btn-ghost" onClick={() => setOpen((v) => !v)} style={{ fontSize: 12, maxWidth: 220 }}>
        <span style={{ color: "var(--inactive)" }}>模型 </span>
        <span style={{ fontWeight: 600 }}>{loading ? "加载中…" : current || "未选择"}</span>
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
            placeholder="搜索模型…"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            style={{ borderBottom: "1px solid var(--border-subtle)" }}
            autoFocus
          />
          <div style={{ maxHeight: 320, overflowY: "auto" }}>
            {filtered.length === 0 ? (
              <div style={{ padding: 12, color: "var(--inactive)", fontSize: 12 }}>无匹配模型</div>
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
