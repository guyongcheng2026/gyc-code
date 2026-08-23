import { memo, useState } from "react"
import type { ChatPart, ToolState } from "../state/chatReducer"

/**
 * 分类工具卡片（对齐 DSH ui-tool render intent 卡 + ui-primitives 各 Block）：
 * - StateDot 状态点：running 脉冲 / 成功绿 / 失败红 / 待执行灰
 * - 默认折叠为紧凑行，点击展开
 * - 输出超过 maxLines 头尾切片 + 展开按钮（对齐 TerminalBlock 16 行约定）
 * - 复制控件写入完整原始输出
 * - 基础 ANSI 转义剥除（SGR/光标移动/清行），保留纯文本呈现
 */

const MAX_LINES = 16

// ---------- ANSI 剥除 ----------
// 剥除无显示意义的转义序列；处理 \r 与行内擦除（\x1b[K）的常见组合。
export function stripAnsi(text: string): string {
  return text
    .replace(/\x1b\[[0-9;?]*[A-HJKSTfhnsu]/g, "")
    .replace(/\x1b\][^\x07]*(\x07|\x1b\\)/g, "")
    .replace(/\x1b[()][0-9A-B]/g, "")
    .replace(/\r(?!\n)/g, "")
}

// ---------- StateDot ----------
export function StateDot({ status }: { status: ToolState["status"] | "pending" }) {
  const color =
    status === "error"
      ? "var(--error)"
      : status === "completed"
        ? "var(--success)"
        : status === "running"
          ? "var(--brand)"
          : "var(--inactive)"
  return (
    <span className="state-dot-wrap" aria-hidden>
      <span
        className={status === "running" ? "state-dot state-dot-running" : "state-dot"}
        style={{ background: color }}
      />
    </span>
  )
}

// ---------- 工具分类 ----------
type ToolKind = "terminal" | "read" | "edit" | "search" | "generic"

const KIND_BY_TOOL: Record<string, ToolKind> = {
  bash: "terminal",
  shell: "terminal",
  pwsh: "terminal",
  powershell: "terminal",
  terminal: "terminal",
  exec: "terminal",
  execute: "terminal",
  run_command: "terminal",
  read: "read",
  view: "read",
  cat: "read",
  edit: "edit",
  write: "edit",
  patch: "edit",
  str_replace: "edit",
  str_replace_editor: "edit",
  notebook_edit: "edit",
  apply_patch: "edit",
  grep: "search",
  glob: "search",
  find: "search",
  search: "search",
  file_search: "search",
}

export function toolKind(tool?: string): ToolKind {
  if (!tool) return "generic"
  const name = tool.toLowerCase()
  if (KIND_BY_TOOL[name]) return KIND_BY_TOOL[name]
  if (name.includes("bash") || name.includes("shell") || name.includes("terminal")) return "terminal"
  if (name.includes("edit") || name.includes("write") || name.includes("patch")) return "edit"
  if (name.includes("search") || name.includes("grep") || name.includes("glob")) return "search"
  if (name.includes("read") || name.includes("view")) return "read"
  return "generic"
}

// ---------- 从 input 提取关键字段 ----------
function pick(input: Record<string, unknown> | undefined, keys: string[]): string {
  if (!input) return ""
  for (const k of keys) {
    const v = input[k]
    if (typeof v === "string" && v) return v
  }
  return ""
}

// ---------- 输出行（头尾切片 + 展开 + 复制） ----------
const OutputLines = memo(function OutputLines({ text, label }: { text: string; label?: string }) {
  const [expanded, setExpanded] = useState(false)
  const [copied, setCopied] = useState(false)
  const lines = stripAnsi(text).replace(/\n+$/, "").split("\n")
  const truncated = !expanded && lines.length > MAX_LINES
  const shown = truncated ? [...lines.slice(0, 8), "⋯", ...lines.slice(-6)] : lines

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(text)
      setCopied(true)
      window.setTimeout(() => setCopied(false), 1200)
    } catch {
      // 剪贴板不可用则忽略
    }
  }

  return (
    <div className="tool-output">
      <div className="tool-output-header">
        <span className="tool-output-label">{label ?? "输出"}</span>
        <span style={{ flex: 1 }} />
        <span className="tool-output-count">{truncated ? `显示 ${shown.length - 1} / 共 ${lines.length} 行` : `${lines.length} 行`}</span>
        {lines.length > MAX_LINES ? (
          <button className="btn btn-ghost tool-mini-btn" onClick={() => setExpanded((v) => !v)}>
            {expanded ? "收起" : "展开"}
          </button>
        ) : null}
        <button className="btn btn-ghost tool-mini-btn" onClick={copy}>
          {copied ? "已复制" : "复制"}
        </button>
      </div>
      <pre className="tool-output-pre">
        {shown.map((line, idx) => (
          <div key={idx}>{line === "" ? "\u00A0" : line}</div>
        ))}
      </pre>
    </div>
  )
})

// ---------- 状态/耗时元信息 ----------
const STATUS_LABEL: Record<string, string> = {
  pending: "待执行",
  running: "执行中",
  completed: "完成",
  error: "失败",
}

function durationOf(st?: ToolState): string {
  if (!st?.time) return ""
  // time 是 {start} 或 {start,end} 联合类型：end 仅在有 end 时存在
  const end = (st.time as { end?: number }).end ?? Date.now()
  const ms = Math.max(0, end - st.time.start)
  return ms >= 1000 ? `${(ms / 1000).toFixed(1)}s` : `${ms}ms`
}

// ---------- 卡片 ----------
export const ToolBlocks = memo(function ToolBlocks({ part }: { part: ChatPart }) {
  const [open, setOpen] = useState(false)
  const st = part.state
  const status = st?.status ?? "pending"
  const kind = toolKind(part.tool)
  const input = st?.input

  // 头行标题：按类型提取最能说明这次调用的字段
  const head = (() => {
    if (part.title) return part.title
    if (kind === "terminal") return pick(input, ["command", "cmd", "script"]) || "命令"
    if (kind === "read") return pick(input, ["path", "file", "filename"]) || "读取文件"
    if (kind === "edit") return pick(input, ["path", "file", "filename"]) || "编辑文件"
    if (kind === "search") return pick(input, ["pattern", "query", "path", "glob"]) || "搜索"
    return part.tool ?? "工具调用"
  })()

  const kindLabel =
    kind === "terminal" ? "终端" : kind === "read" ? "读取" : kind === "edit" ? "编辑" : kind === "search" ? "搜索" : part.tool ?? ""

  const dur = durationOf(st)
  const output = st?.status === "completed" ? st.output : part.output
  const error = st?.status === "error" ? st.error : part.error

  return (
    <div className={`tool-card tool-card-${kind}`} style={{ margin: "6px 0" }}>
      <button className="tool-card-header" onClick={() => setOpen((v) => !v)} aria-expanded={open}>
        <StateDot status={status} />
        <span className="tool-card-kind">{kindLabel}</span>
        <code className="tool-card-head" title={head}>
          {head}
        </code>
        <span style={{ flex: 1 }} />
        {dur ? <span className="tool-card-dur">{dur}</span> : null}
        <span className="tool-card-status" style={{ color: status === "error" ? "var(--error)" : status === "completed" ? "var(--success)" : "var(--inactive)" }}>
          {status === "running" ? "● " : ""}
          {STATUS_LABEL[status] ?? status}
        </span>
        <span className="disclosure-chevron" style={{ transform: open ? "rotate(90deg)" : "none" }}>
          ›
        </span>
      </button>
      {open ? (
        <div className="tool-card-body">
          {input && Object.keys(input).length > 0 && kind === "generic" ? (
            <pre className="tool-input-pre">
              {typeof input === "string" ? input : JSON.stringify(input, null, 2)}
            </pre>
          ) : null}
          {input && kind !== "generic" ? (
            <div className="tool-args">
              {Object.entries(input)
                .filter(([, v]) => typeof v === "string" || typeof v === "number" || typeof v === "boolean")
                .slice(0, 6)
                .map(([k, v]) => (
                  <div key={k} className="tool-arg">
                    <span className="tool-arg-key">{k}</span>
                    <code className="tool-arg-val" title={String(v)}>
                      {String(v).length > 120 ? `${String(v).slice(0, 120)}…` : String(v)}
                    </code>
                  </div>
                ))}
            </div>
          ) : null}
          {output ? <OutputLines text={output} label={kind === "terminal" ? "输出" : "结果"} /> : null}
          {error ? (
            <pre className="tool-error-pre">{typeof error === "string" ? stripAnsi(error) : JSON.stringify(error)}</pre>
          ) : null}
        </div>
      ) : null}
    </div>
  )
})
