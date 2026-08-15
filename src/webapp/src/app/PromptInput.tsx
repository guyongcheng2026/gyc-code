import { useState } from "react"
import type { CommandItem } from "../client/useCommands"
import { SlashMenu } from "./SlashMenu"

export function PromptInput({
  disabled,
  commands,
  onSubmit,
  onCommand,
}: {
  disabled: boolean
  commands: CommandItem[]
  onSubmit: (text: string) => void
  onCommand: (name: string, args: string) => void
}) {
  const [value, setValue] = useState("")
  const [menuOpen, setMenuOpen] = useState(false)
  const [selected, setSelected] = useState(0)

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
      onSubmit(text)
    }
    setValue("")
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
