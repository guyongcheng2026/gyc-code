import type { SessionInfo } from "../client/useSessionInfo"

function fmtCost(cost?: number): string {
  if (cost === undefined) return ""
  return cost >= 0.01 ? `$${cost.toFixed(2)}` : `$${cost.toFixed(4)}`
}

function fmtTokens(n?: number): string {
  if (!n || n === 0) return ""
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`
  return String(n)
}

export function StatusBar({ info }: { info: SessionInfo | null }) {
  if (!info) return null
  const t = info.tokens
  const total = t ? t.input + t.output + t.reasoning : 0
  const cacheTotal = t ? t.cache.read + t.cache.write : 0
  const items = [
    info.status ? `状态: ${info.status}` : "",
    fmtCost(info.cost),
    total > 0 ? `Token: ${fmtTokens(total)}` : "",
    cacheTotal > 0 ? `缓存: ${fmtTokens(cacheTotal)}` : "",
    t && t.reasoning > 0 ? `推理: ${fmtTokens(t.reasoning)}` : "",
    info.todos.length > 0 ? `待办: ${info.todos.filter((x) => !x.done).length}/${info.todos.length}` : "",
  ].filter(Boolean)

  if (items.length === 0) return null
  return (
    <div
      style={{
        display: "flex",
        gap: 16,
        padding: "6px 4px 0",
        fontSize: 11,
        color: "var(--inactive)",
        fontFamily: "var(--font-mono)",
      }}
    >
      {items.map((s) => (
        <span key={s}>{s}</span>
      ))}
    </div>
  )
}

