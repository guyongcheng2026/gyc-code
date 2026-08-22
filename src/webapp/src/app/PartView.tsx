import { memo } from "react"
import type { ChatPart } from "../state/chatReducer"
import { Markdown } from "./Markdown"
import { ToolBlocks } from "./ToolBlocks"
import { DisclosureRow } from "./DisclosureRow"

/**
 * 思考行（对齐 DSH Think 行）：
 * 默认折叠，不展开思维链即暴露实时推理吞吐 ——
 * 流式期间摘要显示最新的非空行；展开后完整推理进入普通页面流。
 */
const ThinkRow = memo(function ThinkRow({ text, streaming }: { text: string; streaming: boolean }) {
  const trimmed = text.trim()
  if (!trimmed && !streaming) return <div className="think-row think-row-empty">思考中…</div>
  const lines = trimmed.split("\n").filter((l) => l.trim() !== "")
  const summary = streaming ? (lines[lines.length - 1] ?? "思考中…") : (lines[0] ?? "")
  return (
    <details className="think-row">
      <summary className="think-row-summary" title={summary}>
        <span className="think-row-label">思考</span>
        <span className="think-row-tail">{streaming ? `…${summary}` : summary}</span>
      </summary>
      <div className="think-row-body">{trimmed}</div>
    </details>
  )
})

export const PartView = memo(function PartView({
  part,
  markdown,
  streaming,
}: {
  part: ChatPart
  markdown?: boolean
  streaming?: boolean
}) {
  switch (part.type) {
    case "text":
      if (!part.text) return null
      return markdown ? <Markdown text={part.text} /> : <span style={{ whiteSpace: "pre-wrap" }}>{part.text}</span>
    case "tool":
      return <ToolBlocks part={part} />
    case "reasoning":
      return <ThinkRow text={part.text ?? ""} streaming={streaming} />
    case "step-start":
      return <div className="step-row">── 开始一步 ──</div>
    case "step-finish":
      return <div className="step-row">── 完成一步 ──</div>
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
        <div className="inline-note inline-note-success">📦 变更: {part.text}</div>
      ) : null
    case "compaction":
      // 压缩检查点行（对齐 DSH compaction 折叠标记）：不替换其上方的记录，仅原地标记
      return (
        <DisclosureRow
          icon={<span style={{ fontSize: 11 }}>⏸</span>}
          title="上下文已压缩"
          meta={(part as { auto?: boolean }).auto ? "自动" : undefined}
          maxHeight={200}
        >
          {part.text ?? "（无摘要内容）"}
        </DisclosureRow>
      )
    case "agent":
      return part.text ? <div className="inline-note inline-note-agent">🤖 子代理: {part.text}</div> : null
    case "file":
      return part.text ? <div className="inline-note inline-note-file">📄 {part.text}</div> : null
    default:
      return part.text ? (
        <span style={{ color: "var(--inactive)", fontSize: 12 }}>{part.text}</span>
      ) : (
        <span style={{ color: "var(--inactive)", fontSize: 12, fontStyle: "italic" }}>[{part.type}]</span>
      )
  }
})
