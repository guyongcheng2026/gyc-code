import { useCallback, useEffect, useRef, useState } from "react"
import { Terminal } from "@xterm/xterm"
import { FitAddon } from "@xterm/addon-fit"
import "@xterm/xterm/css/xterm.css"
import { connectPty, usePty, type PtyConnection } from "../client/usePty"
import { useTheme } from "../client/useTheme"

type PtyEntry = { id: string; title: string; conn: PtyConnection }

// 从 CSS 变量读取当前主题的终端/文字颜色（xterm 需要具体色值）。
function terminalColors() {
  const cs = getComputedStyle(document.documentElement)
  const bg = cs.getPropertyValue("--terminal-bg").trim() || "#FFFFFF"
  const fg = cs.getPropertyValue("--text").trim() || "#000000"
  return { background: bg, foreground: fg }
}

export function TerminalPanel({ directory }: { directory?: string }) {
  const { create, updateSize } = usePty(directory)
  const containerRef = useRef<HTMLDivElement | null>(null)
  const [ptys, setPtys] = useState<PtyEntry[]>([])
  const [activeID, setActiveID] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const termRef = useRef<Terminal | null>(null)
  const fitRef = useRef<FitAddon | null>(null)
  const { theme } = useTheme()

  const addTerminal = async () => {
    setError(null)
    try {
      const id = await create()
      const entry: PtyEntry = { id, title: `终端 ${ptys.length + 1}`, conn: emptyConn() }
      setPtys((prev) => [...prev, entry])
      setActiveID(id)
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    }
  }

  // 激活终端 → 建立连接 + 挂载 xterm + fit + 通知服务端尺寸
  useEffect(() => {
    if (!containerRef.current || !activeID) return
    const entry = ptys.find((p) => p.id === activeID)
    if (!entry) return

    // 连接（若尚未连接）
    let conn = entry.conn
    if (!entry.conn.send) {
      const { background, foreground } = terminalColors()
      const term = new Terminal({ cursorBlink: true, fontSize: 13, theme: { background, foreground } })
      const fit = new FitAddon()
      term.loadAddon(fit)
      termRef.current = term
      fitRef.current = fit
      conn = connectPty(entry.id, {
        onData: (text) => term.write(text),
        onClose: () => term.write("\r\n\x1b[90m[会话已结束]\x1b[0m\r\n"),
      })
      term.onData((input) => conn.send(input))
      term.onResize(({ cols, rows }) => void updateSize(entry.id, cols, rows))
      const el = containerRef.current
      term.open(el)
      try {
        fit.fit()
      } catch {
        // 容器尚未布局完成
      }
      void updateSize(entry.id, term.cols, term.rows)
      setPtys((prev) => prev.map((p) => (p.id === entry.id ? { ...p, conn } : p)))
    }
  }, [activeID, ptys, updateSize])

  // 容器尺寸变化时重新 fit
  useEffect(() => {
    const el = containerRef.current
    if (!el) return
    const ro = new ResizeObserver(() => {
      try {
        fitRef.current?.fit()
      } catch {
        // 忽略
      }
    })
    ro.observe(el)
    return () => ro.disconnect()
  }, [])

  // 主题切换时实时更新激活终端配色（无需重连）
  useEffect(() => {
    const term = termRef.current
    if (!term) return
    const { background, foreground } = terminalColors()
    term.options.theme = { background, foreground }
    term.refresh(0, term.rows - 1)
  }, [theme])

  const closeActive = useCallback(() => {
    if (!activeID) return
    const entry = ptys.find((p) => p.id === activeID)
    entry?.conn.disconnect()
    const next = ptys.filter((p) => p.id !== activeID)
    setPtys(next)
    setActiveID(next.length ? next[next.length - 1].id : null)
  }, [activeID, ptys])

  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100%", background: "var(--terminal-bg)" }}>
      <div style={{ display: "flex", gap: 8, alignItems: "center", padding: "4px 8px", borderBottom: "1px solid var(--border-subtle)" }}>
        <button onClick={addTerminal}>+ 终端</button>
        {ptys.map((p) => (
          <button key={p.id} onClick={() => setActiveID(p.id)} style={{ opacity: p.id === activeID ? 1 : 0.6 }}>
            {p.title}
          </button>
        ))}
        {activeID ? <button onClick={closeActive}>关闭</button> : null}
        {error ? <span style={{ color: "var(--error)", fontSize: 12 }}>{error}</span> : null}
      </div>
      <div ref={containerRef} style={{ flex: 1, minHeight: 0, padding: 4 }} />
    </div>
  )
}

function emptyConn(): PtyConnection {
  return {
    send: () => {},
    disconnect: () => {},
  }
}

