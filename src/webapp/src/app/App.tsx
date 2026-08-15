import { useEffect, useState } from "react"
import { useSessions } from "../client/useSessions"
import { useFileTree } from "../client/useFileTree"
import { useTheme } from "../client/useTheme"
import { sdk } from "../client/sdk"
import { SessionList } from "./SessionList"
import { ChatPanel } from "./ChatPanel"
import { FileTree } from "./FileTree"
import { FileViewer } from "./FileViewer"
import { DiffView } from "./DiffView"
import { TerminalPanel } from "./TerminalPanel"

type MainTab = "chat" | "diff"

export function App() {
  const { sessions, reload } = useSessions()
  const [selected, setSelected] = useState<string | null>(null)
  const [tab, setTab] = useState<MainTab>("chat")
  const [filePath, setFilePath] = useState<string | null>(null)
  const [showTerminal, setShowTerminal] = useState(true)
  const tree = useFileTree()
  const { theme, toggle } = useTheme()

  // 支持 #sessionId 深链（如 fork 后导航到新会话）
  useEffect(() => {
    const sync = () => {
      const hash = window.location.hash.replace(/^#/, "")
      if (hash) setSelected(hash)
    }
    sync()
    window.addEventListener("hashchange", sync)
    return () => window.removeEventListener("hashchange", sync)
  }, [])

  const onNew = async () => {
    const res = await sdk().session.create({ body: {} })
    const created = (res.data as { id: string } | undefined)?.id
    if (created) {
      setSelected(created)
      await reload()
    }
  }

  return (
    <main
      style={{
        display: "flex",
        flexDirection: "column",
        height: "100vh",
        margin: 0,
        background: "var(--app-bg)",
      }}
    >
      <div style={{ display: "flex", flex: 1, minHeight: 0 }}>
        {/* 左栏：会话（Codex 项目/线程）+ 文件 */}
        <aside
          style={{
            display: "flex",
            flexDirection: "column",
            width: 260,
            borderRight: "1px solid var(--border-subtle)",
            background: "var(--panel-bg)",
          }}
        >
          <div style={{ padding: 10, borderBottom: "1px solid var(--border-subtle)" }}>
            <button className="btn btn-primary" onClick={onNew} style={{ width: "100%", fontWeight: 600 }}>
              + 新会话
            </button>
          </div>
          <div style={{ borderBottom: "1px solid var(--border-subtle)", maxHeight: "40%", overflowY: "auto", padding: "4px 6px" }}>
            <div style={{ fontSize: 11, color: "var(--inactive)", padding: "6px 8px", letterSpacing: "0.05em" }}>
              线程
            </div>
            <SessionList sessions={sessions} selected={selected} onSelect={setSelected} onNew={onNew} />
          </div>
          <div style={{ flex: 1, minHeight: 0, overflowY: "auto", padding: "4px 6px" }}>
            <div style={{ fontSize: 11, color: "var(--inactive)", padding: "6px 8px", letterSpacing: "0.05em" }}>
              项目
            </div>
            <FileTree state={tree.state} selected={filePath} onSelect={setFilePath} onToggle={tree.toggle} />
          </div>
        </aside>

        {/* 主区：居中内容列 */}
        <section style={{ display: "flex", flexDirection: "column", flex: 1, minWidth: 0 }}>
          {/* 顶部标签栏 */}
          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: 4,
              padding: "6px 16px",
              borderBottom: "1px solid var(--border-subtle)",
            }}
          >
            <span style={{ fontWeight: 700, marginRight: 12, fontSize: 13 }}>
              gyc<span style={{ color: "var(--claude)" }}>·</span>web
            </span>
            {!filePath ? (
              <>
                <button
                  className="btn btn-ghost"
                  style={{ opacity: tab === "chat" ? 1 : 0.55 }}
                  onClick={() => setTab("chat")}
                >
                  对话
                </button>
                <button
                  className="btn btn-ghost"
                  style={{ opacity: tab === "diff" ? 1 : 0.55 }}
                  onClick={() => setTab("diff")}
                >
                  改动
                </button>
              </>
            ) : (
              <button className="btn btn-ghost" onClick={() => setFilePath(null)}>
                ← 返回
              </button>
            )}
            <button className="btn btn-ghost" style={{ marginLeft: "auto" }} onClick={toggle}>
              {theme === "light" ? "🌙 深色" : "☀️ 亮色"}
            </button>
            <button className="btn btn-ghost" onClick={() => setShowTerminal((v) => !v)}>
              {showTerminal ? "收起终端" : "展开终端"}
            </button>
          </div>

          {/* 居中内容（Codex：结果区居中，max-width） */}
          <div style={{ flex: 1, minHeight: 0, display: "flex", justifyContent: "center" }}>
            <div
              style={{
                width: "100%",
                maxWidth: filePath || tab === "diff" ? "100%" : 760,
                height: "100%",
                display: "flex",
                flexDirection: "column",
              }}
            >
              {filePath ? (
                <div style={{ flex: 1, minHeight: 0, display: "flex", flexDirection: "column" }}>
                  <div style={{ padding: "6px 16px", fontSize: 12, color: "var(--inactive)", borderBottom: "1px solid var(--border-subtle)" }}>
                    <code>{filePath}</code>
                  </div>
                  <div style={{ flex: 1, minHeight: 0 }}>
                    <FileViewer path={filePath} />
                  </div>
                </div>
              ) : tab === "chat" ? (
                selected ? (
                  <ChatPanel sessionID={selected} />
                ) : (
                  <div style={{ flex: 1, display: "flex", alignItems: "center", justifyContent: "center", color: "var(--inactive)" }}>
                    选择或新建一个会话
                  </div>
                )
              ) : (
                <div style={{ flex: 1, minHeight: 0 }}>
                  <DiffView sessionID={selected} />
                </div>
              )}
            </div>
          </div>
        </section>
      </div>

      {/* 底部终端 */}
      {showTerminal ? (
        <div style={{ height: 220, borderTop: "1px solid var(--border-subtle)" }}>
          <TerminalPanel />
        </div>
      ) : null}
    </main>
  )
}
