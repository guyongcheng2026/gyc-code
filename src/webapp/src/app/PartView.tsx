import type { ChatPart } from "../state/chatReducer"

const TOOL_STATUS: Record<string, { label: string; color: string }> = {
  pending: { label: "待执行", color: "var(--inactive)" },
  running: { label: "执行中", color: "var(--suggestion)" },
  completed: { label: "完成", color: "var(--success)" },
  error: { label: "失败", color: "var(--error)" },
}

function ToolCard({ part }: { part: ChatPart }) {
  const st = part.state
  const status = st?.status ?? "pending"
  const s = TOOL_STATUS[status] ?? TOOL_STATUS.pending
  const title = part.title ?? (st as { title?: string } | undefined)?.title ?? part.tool
  const input = st?.input
  const output = st?.status === "completed" ? st.output : part.output
  const error = st?.status === "error" ? st.error : part.error

  return (
    <div className="tool-card" style={{ margin: "6px 0" }}>
      <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
        <span className="badge" style={{ background: s.color, color: "#fff", fontWeight: 700 }}>
          {part.tool?.slice(0, 2).toUpperCase() ?? "TL"}
        </span>
        <span style={{ fontWeight: 600, fontSize: 13 }}>{title ?? part.tool}</span>
        <code style={{ color: "var(--inactive)", fontSize: 11 }}>{part.tool}</code>
        <span style={{ marginLeft: "auto", fontSize: 11, color: s.color }}>{status === "running" ? "● " : ""}{s.label}</span>
      </div>
      {input && Object.keys(input).length > 0 ? (
        <pre
          style={{
            whiteSpace: "pre-wrap",
            fontFamily: "var(--font-mono)",
            fontSize: 12,
            color: "var(--inactive)",
            background: "var(--code-bg)",
            borderRadius: 6,
            padding: 8,
            margin: "6px 0",
            maxHeight: 180,
            overflow: "auto",
          }}
        >
          {typeof input === "string" ? input : JSON.stringify(input, null, 2)}
        </pre>
      ) : null}
      {output ? (
        <pre
          style={{
            whiteSpace: "pre-wrap",
            fontFamily: "var(--font-mono)",
            fontSize: 12,
            color: "var(--text)",
            background: "var(--code-bg)",
            borderRadius: 6,
            padding: 8,
            margin: 0,
            maxHeight: 240,
            overflow: "auto",
          }}
        >
          {output}
        </pre>
      ) : null}
      {error ? (
        <pre style={{ whiteSpace: "pre-wrap", fontFamily: "var(--font-mono)", fontSize: 12, color: "var(--error)", margin: 0 }}>
          {error}
        </pre>
      ) : null}
    </div>
  )
}

export function PartView({ part }: { part: ChatPart }) {
  switch (part.type) {
    case "text":
      return part.text ? <span>{part.text}</span> : null
    case "tool":
      return <ToolCard part={part} />
    case "reasoning":
      return (
        <div style={{ color: "var(--inactive)", fontStyle: "italic", fontSize: 12, margin: "4px 0" }}>
          {part.text ? `思考：${part.text}` : "思考中…"}
        </div>
      )
    case "step-start":
      return <div style={{ color: "var(--inactive)", fontSize: 12, margin: "4px 0", opacity: 0.7 }}>── 开始一步 ──</div>
    case "step-finish":
      return <div style={{ color: "var(--inactive)", fontSize: 12, margin: "4px 0", opacity: 0.7 }}>── 完成一步 ──</div>
    case "subtask":
      return (
        <div className="tool-card" style={{ margin: "4px 0" }}>
          <strong style={{ fontSize: 13 }}>{part.description ?? "子任务"}</strong>
          {part.prompt ? (
            <div style={{ fontSize: 12, color: "var(--inactive)", whiteSpace: "pre-wrap", marginTop: 4 }}>{part.prompt}</div>
          ) : null}
        </div>
      )
    case "patch":
      return part.text ? (
        <div style={{ fontSize: 12, color: "var(--success)", fontFamily: "var(--font-mono)", margin: "4px 0" }}>📦 变更: {part.text}</div>
      ) : null
    case "agent":
      return part.text ? (
        <div style={{ fontSize: 12, color: "var(--plan-mode)", margin: "4px 0" }}>🤖 agent: {part.text}</div>
      ) : null
    case "file":
      return part.text ? (
        <div style={{ fontSize: 12, color: "var(--permission)", fontFamily: "var(--font-mono)", margin: "4px 0" }}>📄 {part.text}</div>
      ) : null
    default:
      return part.text ? (
        <span style={{ color: "var(--inactive)", fontSize: 12 }}>{part.text}</span>
      ) : (
        <span style={{ color: "var(--inactive)", fontSize: 12, fontStyle: "italic" }}>[{part.type}]</span>
      )
  }
}
