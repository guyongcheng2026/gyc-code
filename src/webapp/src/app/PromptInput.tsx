import { useState } from "react"
import type { CommandItem } from "../client/useCommands"
import { SlashMenu } from "./SlashMenu"

export type PromptAttachment = { url: string; filename?: string }

export function PromptInput({
  disabled,
  commands,
  onSubmit,
  onCommand,
  onTabCycle,
}: {
  disabled: boolean
  commands: CommandItem[]
  onSubmit: (text: string, files: PromptAttachment[]) => void
  onCommand: (name: string, args: string) => void
  onTabCycle?: (delta: number) => void
}) {
  const [value, setValue] = useState("")
  const [menuOpen, setMenuOpen] = useState(false)
  const [selected, setSelected] = useState(0)
  const [attachments, setAttachments] = useState<PromptAttachment[]>([])
  const [pathOpen, setPathOpen] = useState(false)
  const [pathValue, setPathValue] = useState("")

  const addPath = () => {
    const path = pathValue.trim()
    if (!path) return
    const filename = path.split(/[\\/]/).pop() || path
    setAttachments((prev) => [...prev, { url: path, filename }])
    setPathValue("")
    setPathOpen(false)
  }

  // 斜杠命令过滤
  const isSlash = value.startsWith("/") && !value.startsWith("/ ")
  const parts = isSlash ? value.split(/\s+/) : []
  const currentCmd = parts[1] ?? ""
  const filtered = isSlash
    ? commands.filter((c) => c.name.startsWith(currentCmd) && currentCmd.length < c.name.length)
    : []

  const submit = () => {
    const text = value.trim()
    if (!text || disabled) return
    if (text.startsWith("/") && !text.startsWith("/ ")) {
      const [name, ...rest] = text.slice(1).split(/\s+/)
      onCommand(name, rest.join(" "))
    } else {
      onSubmit(text, attachments)
    }
    setValue("")
    setAttachments([])
    setMenuOpen(false)
  }

  const handleKey = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && !e.shiftKey) {
      if (filtered.length > 0) {
        e.preventDefault()
        const cmd = filtered[selected]
        if (cmd) {
          setValue(`/${cmd.name} `)
          setSelected(0)
          setMenuOpen(true)
        }
        return
      }
      submit()
    } else if (e.key === "ArrowDown" && filtered.length > 0) {
      e.preventDefault()
      setSelected((s) => (s + 1) % filtered.length)
    } else if (e.key === "ArrowUp" && filtered.length > 0) {
      e.preventDefault()
      setSelected((s) => (s - 1 + filtered.length) % filtered.length)
    } else if (e.key === "Escape") {
      setMenuOpen(false)
    } else if (e.key === "Tab") {
      e.preventDefault()
      if (filtered.length > 0) {
        // 斜杠命令菜单打开：TAB 补全命令
        const cmd = filtered[selected]
        if (cmd) {
          setValue(`/${cmd.name} `)
          setSelected(0)
          setMenuOpen(true)
        }
      } else {
        // 无命令菜单：TAB 循环模式（Shift+TAB 反向），复刻 TUI agent.cycle
        onTabCycle?.(e.shiftKey ? -1 : 1)
      }
    }
  }

  return (
    <div style={{ position: "relative" }}>
      {menuOpen && filtered.length > 0 ? (
        <SlashMenu
          items={filtered}
          selected={selected}
          onSelect={(i) => {
            const cmd = filtered[i]
            if (cmd) {
              setValue(`/${cmd.name} `)
              setSelected(0)
              setMenuOpen(true)
            }
          }}
          onClose={() => setMenuOpen(false)}
        />
      ) : null}
      {attachments.length > 0 ? (
        <div style={{ display: "flex", flexWrap: "wrap", gap: 6, marginBottom: 6 }}>
          {attachments.map((file, index) => (
            <span
              key={index}
              style={{
                display: "inline-flex",
                alignItems: "center",
                gap: 6,
                fontSize: 12,
                padding: "2px 8px",
                borderRadius: 10,
                border: "1px solid var(--border)",
                background: "var(--selection-bg)",
              }}
            >
              📎 {file.filename || file.url}
              <button
                className="btn"
                style={{ fontSize: 10, padding: "0 4px", border: "none", color: "var(--inactive)" }}
                onClick={() => setAttachments((prev) => prev.filter((_, i) => i !== index))}
              >
                ✕
              </button>
            </span>
          ))}
        </div>
      ) : null}
      {pathOpen ? (
        <div style={{ display: "flex", gap: 6, marginBottom: 6 }}>
          <input
            className="text-input"
            placeholder="输入项目内文件相对路径，如 src/foo.ts"
            value={pathValue}
            onChange={(e) => setPathValue(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault()
                addPath()
              }
              if (e.key === "Escape") {
                setPathOpen(false)
                setPathValue("")
              }
            }}
            style={{ flex: 1 }}
            autoFocus
          />
          <button className="btn" onClick={addPath}>
            添加
          </button>
          <button
            className="btn"
            onClick={() => {
              setPathOpen(false)
              setPathValue("")
            }}
          >
            取消
          </button>
        </div>
      ) : null}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 8,
          background: "var(--panel-bg)",
          border: "1px solid var(--border)",
          borderRadius: 12,
          padding: "4px 4px 4px 12px",
          boxShadow: "0 2px 8px rgba(0,0,0,0.15)",
        }}
      >
        <input
          className="text-input"
          placeholder="描述任务，或输入 / 查看命令…"
          value={value}
          disabled={disabled}
          onChange={(e) => {
            setValue(e.target.value)
            setMenuOpen(true)
            setSelected(0)
          }}
          onKeyDown={handleKey}
          onFocus={() => setMenuOpen(true)}
          onBlur={() => setTimeout(() => setMenuOpen(false), 150)}
        />
        <button
          className="btn"
          title="引用项目文件路径"
          style={{ borderRadius: 8, padding: "8px 10px", fontSize: 14 }}
          disabled={disabled || pathOpen}
          onClick={() => setPathOpen((v) => !v)}
        >
          📎
        </button>
        <button
          className="btn"
          style={{ borderRadius: 8, padding: "8px 14px", fontWeight: 600 }}
          disabled={disabled || !value.trim()}
          onClick={submit}
        >
          发送
        </button>
      </div>
    </div>
  )
}
