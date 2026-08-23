import { memo } from "react"
import { Virtuoso } from "react-virtuoso"
import type { ChatMessage } from "../state/chatReducer"
import { PartView } from "./PartView"

// 消息错误可能是字符串或 NamedError 对象，统一提取可读文本（避免显示 [object Object]）。
function errorText(error: unknown): string {
  if (typeof error === "string" && error) return error
  if (error && typeof error === "object") {
    const obj = error as { data?: { message?: unknown }; message?: unknown; name?: unknown }
    if (typeof obj.data?.message === "string" && obj.data.message) return obj.data.message
    if (typeof obj.message === "string" && obj.message) return obj.message
    if (typeof obj.name === "string" && obj.name) return obj.name
  }
  return "未知错误"
}

/**
 * 轮次操作行（对齐 DSH 已定稿内容的 IconActions）：
 * assistant 消息尾部 hover 显示复制操作。
 */
const MessageActions = memo(function MessageActions({ text }: { text: string }) {
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(text)
    } catch {
      // 剪贴板不可用则忽略
    }
  }
  return (
    <div className="msg-actions">
      <button className="btn btn-ghost msg-action-btn" title="复制全文" onClick={copy}>
        复制
      </button>
    </div>
  )
})

export function MessageList({ messages, busy }: { messages: ChatMessage[]; busy: boolean }) {
  // 空态引导：新会话 / 标签页切回时避免整块空白（对齐 codex web / Claude Code 空会话提示）
  if (messages.length === 0 && !busy) {
    return (
      <div
        style={{
          flex: 1,
          minHeight: 0,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          color: "var(--inactive)",
          textAlign: "center",
          padding: 24,
          lineHeight: 1.8,
        }}
      >
        <div>
          <div style={{ fontWeight: 600, fontSize: 15, color: "var(--fg)", marginBottom: 6 }}>开始新的会话</div>
          <div style={{ fontSize: 13 }}>输入消息开始与 gyc 对话；输入 / 查看可用命令。</div>
        </div>
      </div>
    )
  }
  return (
    <Virtuoso
      style={{ flex: 1, minHeight: 0 }}
      data={messages}
      followOutput="smooth"
      itemContent={(_, m) => {
        // 流式隔离：仅 busy 时最后一条消息的最后一个 part 视为流式尾部
        const isTail = busy && m.id === messages[messages.length - 1]?.id
        const assistantText = m.parts
          .filter((p) => p.type === "text")
          .map((p) => p.text ?? "")
          .join("\n\n")
          .trim()
        return (
          <div
            key={m.id}
            className={`msg${m.role === "user" ? " msg-user" : " msg-assistant"}`}
            style={{ margin: "4px 0", lineHeight: 1.6 }}
          >
            <div style={{ fontSize: 12, fontWeight: 700, marginBottom: 4 }}>
              {m.role === "user" ? (
                <span style={{ color: "var(--inactive)" }}>你</span>
              ) : (
                <span style={{ color: "var(--brand)" }}>gyc</span>
              )}
            </div>
            <div style={{ wordBreak: "break-word" }}>
              {m.parts?.map((p, idx) => (
                <PartView
                  key={p.id}
                  part={p}
                  markdown={m.role === "assistant" && p.type === "text"}
                  streaming={isTail && idx === m.parts.length - 1}
                />
              )) ?? ""}
            </div>
            {m.error ? <div style={{ color: "var(--error)", marginTop: 4 }}>错误: {errorText(m.error)}</div> : null}
            {m.role === "assistant" && assistantText && !isTail ? <MessageActions text={assistantText} /> : null}
          </div>
        )
      }}
    />
  )
}
