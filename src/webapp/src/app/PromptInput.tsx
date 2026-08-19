import { useMemo, useRef, useState } from "react"
import type { CommandItem } from "../client/useCommands"
import { SlashMenu } from "./SlashMenu"

export type PromptAttachment = { url: string; filename?: string; mime?: string }

const MAX_INPUT_ROWS = 8
const AT_MENU_LIMIT = 20

/**
 * 输入区（对齐 DSH InputBar 交互）：
 * - 多行 textarea 自动增高（1~8 行），Enter 发送 / Shift+Enter 换行 / Ctrl+Enter 发送
 * - 粘贴与拖放文件进入附件栏（图片 chip 预览）
 * - `/` 前缀命令菜单（↑↓/Tab 补全/Enter 执行/Esc 关闭）
 * - `@` 光标触发文件引用菜单（对齐 input-trigger 流水线的 @ source）
 */
export function PromptInput({
  disabled,
  busy,
  commands,
  files,
  onSubmit,
  onCommand,
  onTabCycle,
}: {
  disabled: boolean
  busy?: boolean
  commands: CommandItem[]
  files?: string[]
  onSubmit: (text: string, files: PromptAttachment[], delivery?: "queue" | "steer") => void
  onCommand: (name: string, args: string) => void
  onTabCycle?: (delta: number) => void
}) {
  const [value, setValue] = useState("")
  const [menuOpen, setMenuOpen] = useState(true)
  const [selected, setSelected] = useState(0)
  const [attachments, setAttachments] = useState<PromptAttachment[]>([])
  const [pathOpen, setPathOpen] = useState(false)
  const [pathValue, setPathValue] = useState("")
  const [dragOver, setDragOver] = useState(false)
  const [atIdx, setAtIdx] = useState(0)
  const taRef = useRef<HTMLTextAreaElement | null>(null)

  // ---------- 附件 ----------
  const addFiles = (list: FileList | File[]) => {
    const next: PromptAttachment[] = []
    for (const f of Array.from(list)) {
      const isImage = f.type.startsWith("image/")
      const url = isImage ? URL.createObjectURL(f) : f.name
      next.push({ url, filename: f.name, mime: f.type || "application/octet-stream" })
    }
    if (next.length > 0) setAttachments((prev) => [...prev, ...next])
  }

  const addPath = () => {
    const path = pathValue.trim()
    if (!path) return
    const filename = path.split(/[\\/]/).pop() || path
    setAttachments((prev) => [...prev, { url: path, filename }])
    setPathValue("")
    setPathOpen(false)
  }

  // ---------- 斜杠命令过滤 ----------
  const isSlash = value.startsWith("/") && !value.startsWith("/ ")
  const parts = isSlash ? value.split(/\s+/) : []
  const currentCmd = parts[1] ?? ""
  const filtered = isSlash
    ? commands.filter((c) => c.name.startsWith(currentCmd) && currentCmd.length < c.name.length)
    : []

  // ---------- @ 文件触发（光标前缀检测） ----------
  const atMenu = useMemo(() => {
    const ta = taRef.current
    const pos = ta?.selectionStart ?? value.length
    const before = value.slice(0, pos)
    const m = /@([^@\s]*)$/.exec(before)
    if (!m || !files || files.length === 0) return null
    const query = m[1].toLowerCase()
    const matched = files.filter((f) => f.toLowerCase().includes(query)).slice(0, AT_MENU_LIMIT)
    if (matched.length === 0) return null
    return { query: m[0], start: pos - m[0].length, items: matched }
  }, [value, files])

  const pickAt = (path: string) => {
    const ta = taRef.current
    if (!ta || !atMenu) return
    const pos = ta.selectionStart
    const next = `${value.slice(0, atMenu.start)}${path} ${value.slice(pos)}`
    setValue(next)
    requestAnimationFrame(() => {
      const cursor = atMenu.start + path.length + 1
      ta.focus()
      ta.setSelectionRange(cursor, cursor)
    })
  }

  // ---------- 提交 ----------
  // busy 态投递约定（对齐 DSH busyEnter）：Enter = queue（排队下一轮），
  // Ctrl+Enter = steer（插入当前轮次）；空闲态两者都是普通发送。
  const submit = (delivery?: "queue" | "steer") => {
    const text = value.trim()
    if (!text || disabled) return
    if (text.startsWith("/") && !text.startsWith("/ ")) {
      const [name, ...rest] = text.slice(1).split(/\s+/)
      onCommand(name, rest.join(" "))
    } else {
      onSubmit(text, attachments, busy ? (delivery ?? "queue") : undefined)
    }
    setValue("")
    setAttachments([])
    setMenuOpen(true)
    setSelected(0)
  }

  const handleKey = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    // 菜单导航（斜杠命令或 @ 文件）
    const menuLen = filtered.length > 0 ? filtered.length : (atMenu?.items.length ?? 0)
    if (menuLen > 0) {
      if (e.key === "ArrowDown") {
        e.preventDefault()
        setAtIdx((s) => (s + 1) % menuLen)
        return
      }
      if (e.key === "ArrowUp") {
        e.preventDefault()
        setAtIdx((s) => (s - 1 + menuLen) % menuLen)
        return
      }
    }
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
      if (atMenu) {
        e.preventDefault()
        pickAt(atMenu.items[atIdx] ?? atMenu.items[0] ?? "")
        return
      }
      e.preventDefault()
      submit(e.ctrlKey || e.metaKey ? "steer" : undefined)
    } else if (e.key === "Escape") {
      setMenuOpen(false)
    } else if (e.key === "Tab") {
      e.preventDefault()
      if (filtered.length > 0) {
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

  // ---------- 自动增高 ----------
  const autoGrow = (el: HTMLTextAreaElement) => {
    el.style.height = "auto"
    const lineHeight = 21
    const h = Math.min(el.scrollHeight, lineHeight * MAX_INPUT_ROWS)
    el.style.height = `${h}px`
    el.style.overflowY = el.scrollHeight > h ? "auto" : "hidden"
  }

  return (
    <div
      style={{ position: "relative" }}
      onDragOver={(e) => {
        if (e.dataTransfer.types.includes("Files")) {
          e.preventDefault()
          setDragOver(true)
        }
      }}
      onDragLeave={() => setDragOver(false)}
      onDrop={(e) => {
        if (e.dataTransfer.files.length > 0) {
          e.preventDefault()
          addFiles(e.dataTransfer.files)
        }
        setDragOver(false)
      }}
    >
      {dragOver ? <div className="drop-overlay">松开以添加附件</div> : null}

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

      {atMenu ? (
        <div className="at-menu">
          <div className="at-menu-title">文件</div>
          {atMenu.items.map((f, i) => (
            <div
              key={f}
              className={i === atIdx ? "at-menu-item active" : "at-menu-item"}
              onMouseEnter={() => setAtIdx(i)}
              onMouseDown={(e) => {
                e.preventDefault() // 保持 textarea 焦点
                pickAt(f)
              }}
            >
              <code>{f}</code>
            </div>
          ))}
          <div className="at-menu-footer">
            <span>↑↓ 选择</span>
            <span>Enter 插入</span>
          </div>
        </div>
      ) : null}

      {attachments.length > 0 ? (
        <div style={{ display: "flex", flexWrap: "wrap", gap: 6, marginBottom: 6 }}>
          {attachments.map((file, index) => (
            <span key={index} className="attach-chip">
              {file.mime?.startsWith("image/") ? (
                <img src={file.url} alt={file.filename} className="attach-thumb" />
              ) : (
                "📎"
              )}{" "}
              {file.filename || file.url}
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
        className={disabled ? "prompt-bar disabled" : "prompt-bar"}
        onPaste={(e) => {
          if (e.clipboardData.files.length > 0) {
            e.preventDefault()
            addFiles(e.clipboardData.files)
          }
        }}
      >
        <textarea
          ref={taRef}
          className="text-input prompt-textarea"
          placeholder={busy ? "运行中… Enter 排队 · Ctrl+Enter 插话" : "描述任务，/ 命令，@ 引用文件…"}
          value={value}
          rows={1}
          disabled={disabled}
          onChange={(e) => {
            setValue(e.target.value)
            setMenuOpen(true)
            setSelected(0)
            setAtIdx(0)
            autoGrow(e.target)
          }}
          onKeyDown={handleKey}
        />
        <button
          className="btn"
          title="引用项目文件路径"
          style={{ borderRadius: 8, padding: "8px 10px", fontSize: 14, alignSelf: "flex-end" }}
          disabled={disabled || pathOpen}
          onClick={() => setPathOpen((v) => !v)}
        >
          📎
        </button>
        <button
          className="btn"
          style={{ borderRadius: 8, padding: "8px 14px", fontWeight: 600, alignSelf: "flex-end" }}
          disabled={disabled || !value.trim()}
          onClick={() => submit()}
        >
          {busy ? "排队" : "发送"}
        </button>
      </div>
    </div>
  )
}
