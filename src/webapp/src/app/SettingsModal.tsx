import { useMemo, useState } from "react"
import { useModels } from "../client/useModels"

type SettingsTab = "models" | "general"

// 设置中心（对齐 DSH settings：模型/通用）。模型数据来自 provider.list +
// v2 model.list 增强（与 ModelPicker 同一数据源），纯前端聚合、真实可用。
export function SettingsModal({ directory, onClose }: { directory?: string; onClose: () => void }) {
  const { models, loading } = useModels(directory)
  const [tab, setTab] = useState<SettingsTab>("models")
  const [query, setQuery] = useState("")

  const groups = useMemo(() => {
    const q = query.trim().toLowerCase()
    const filtered = q ? models.filter((m) => `${m.providerID}/${m.modelID} ${m.modelName}`.toLowerCase().includes(q)) : models
    const map = new Map<string, typeof models>()
    for (const m of filtered) {
      const list = map.get(m.providerName) ?? []
      list.push(m)
      map.set(m.providerName, list)
    }
    return [...map.entries()].map(([name, list]) => ({ name, list }))
  }, [models, query])

  return (
    <div
      style={{ position: "fixed", inset: 0, zIndex: 100, display: "flex", alignItems: "center", justifyContent: "center", background: "rgba(0,0,0,0.4)" }}
      onClick={onClose}
    >
      <div
        className="settings-modal"
        style={{ background: "var(--app-bg)", border: "1px solid var(--border)", borderRadius: 12, width: 640, maxWidth: "92vw", maxHeight: "80vh", display: "flex", flexDirection: "column", overflow: "hidden" }}
        onClick={(e) => e.stopPropagation()}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 4, padding: "10px 16px", borderBottom: "1px solid var(--border-subtle)" }}>
          <span style={{ fontWeight: 700, fontSize: 13, marginRight: "auto" }}>设置</span>
          <button className="btn btn-ghost" style={{ fontSize: 12 }} onClick={() => setTab("models")}>模型</button>
          <button className="btn btn-ghost" style={{ fontSize: 12 }} onClick={() => setTab("general")}>通用</button>
          <button className="btn btn-ghost" style={{ fontSize: 14, padding: "0 8px" }} onClick={onClose} title="关闭">×</button>
        </div>

        <div style={{ flex: 1, minHeight: 0, overflowY: "auto", padding: "12px 16px" }}>
          {tab === "models" ? (
            <>
              <div style={{ display: "flex", gap: 8, marginBottom: 10 }}>
                <input
                  className="text-input"
                  placeholder="搜索提供商 / 模型…"
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  style={{ flex: 1, fontSize: 12 }}
                  autoFocus
                />
                <span style={{ fontSize: 12, color: "var(--inactive)", alignSelf: "center" }}>
                  {loading ? "加载中…" : `${models.length} 个模型`}
                </span>
              </div>
              {groups.length === 0 ? (
                <div style={{ fontSize: 12, color: "var(--inactive)", padding: "20px 0", textAlign: "center" }}>暂无模型（请先在 CLI 配置提供商）</div>
              ) : (
                groups.map((group) => (
                  <div key={group.name} style={{ marginBottom: 12 }}>
                    <div style={{ fontSize: 12, fontWeight: 600, color: "var(--inactive)", padding: "4px 0", borderBottom: "1px solid var(--border-subtle)" }}>
                      {group.name} <span style={{ fontWeight: 400 }}>({group.list.length})</span>
                    </div>
                    {group.list.map((m) => (
                      <div key={m.label} style={{ display: "flex", alignItems: "center", gap: 8, padding: "5px 4px", fontSize: 12, borderBottom: "1px solid var(--border-subtle)" }}>
                        <code style={{ color: "var(--brand)", fontSize: 12 }}>{m.modelID}</code>
                        <span style={{ color: "var(--inactive)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", flex: 1 }}>{m.modelName}</span>
                        {m.variants.length > 0 ? (
                          <span style={{ fontSize: 11, color: "var(--inactive)" }}>变体: {m.variants.join(", ")}</span>
                        ) : null}
                      </div>
                    ))}
                  </div>
                ))
              )}
            </>
          ) : (
            <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
              <div>
                <div style={{ fontSize: 12, fontWeight: 600, color: "var(--inactive)", marginBottom: 4 }}>工作区目录</div>
                <div style={{ fontSize: 12 }}>
                  {directory ? <code>{directory}</code> : <span style={{ color: "var(--inactive)" }}>服务端默认目录</span>}
                </div>
              </div>
              <div>
                <div style={{ fontSize: 12, fontWeight: 600, color: "var(--inactive)", marginBottom: 4 }}>主题</div>
                <div style={{ fontSize: 12 }}>顶部「亮色 → 深色 → 跟随系统」按钮循环切换</div>
              </div>
              <div>
                <div style={{ fontSize: 12, fontWeight: 600, color: "var(--inactive)", marginBottom: 4 }}>关于</div>
                <div style={{ fontSize: 12 }}>
                  gyc·web — 基于 gyc-code 服务端的 Web 界面
                </div>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}