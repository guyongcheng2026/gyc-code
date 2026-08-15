import { useState } from "react"
import { useSessions } from "../client/useSessions"
import { useFileTree } from "../client/useFileTree"
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

  const onNew = async () => {
    const res = await sdk().session.create({ body: {} })
    const created = (res.data as { id: string } | undefined)?.id
    if (created) {
      setSelected(created)
      await reload()
    }
  }

  return (
    <main style={{ display: "flex", flexDirection: "column", height: "100vh", margin: 0 }}>
      <header
        style={{
          display: "flex", alignItems: "center", gap: 16, padding: "6px 16px",
          borderBottom: "1px solid #333", background: "#161b22", fontSize: 14,
        }}
      >
        <strong>gyc web</strong>
        <span style={{ color: "#888" }}>编码智能体</span>
        <button onClick={() => setShowTerminal((v) => !v)} style={{ marginLeft: "auto" }}>
          {showTerminal ? "收起终端" : "展开终端"}
        </button>
      </header>

      <div style={{ display: "flex", flex: 1, minHeight: 0 }}>
        {/* 左栏：会话列表 + 文件树 */}
        <aside style={{ display: "flex", flexDirection: "column", width: 240, borderRight: "1px solid #333", background: "#0d1117" }}>
          <div style={{ borderBottom: "1px solid #333", maxHeight: "38%", overflowY: "auto" }}>
            <SessionList sessions={sessions} selected={selected} onSelect={setSelected} onNew={onNew} />
          </div>
          <div style={{ flex: 1, minHeight: 0, padding: 4 }}>
            <div style={{ fontSize: 12, color: "#888", padding: "4px 8px" }}>文件</div>
            <FileTree state={tree.state} selected={filePath} onSelect={setFilePath} onToggle={tree.toggle} />
          </div>
        </aside>

        {/* 主区：对话 / Diff / 文件 */}
        <section style={{ display: "flex", flexDirection: "column", flex: 1, minWidth: 0 }}>
          {filePath ? (
            <>
              <div style={{ display: "flex", gap: 8, alignItems: "center", padding: "4px 8px", borderBottom: "1px solid #333" }}>
                <button onClick={() => setFilePath(null)}>← 返回</button>
                <code style={{ fontSize: 12 }}>{filePath}</code>
              </div>
              <div style={{ flex: 1, minHeight: 0 }}>
                <FileViewer path={filePath} />
              </div>
            </>
          ) : (
            <>
              <div style={{ display: "flex", gap: 8, padding: "4px 8px", borderBottom: "1px solid #333" }}>
                <button onClick={() => setTab("chat")} style={{ opacity: tab === "chat" ? 1 : 0.6 }}>对话</button>
                <button onClick={() => setTab("diff")} style={{ opacity: tab === "diff" ? 1 : 0.6 }}>改动</button>
              </div>
              <div style={{ flex: 1, minHeight: 0 }}>
                {tab === "chat" ? (
                  selected ? <ChatPanel sessionID={selected} /> : <div style={{ padding: 24, color: "#888" }}>选择或新建一个会话</div>
                ) : (
                  <DiffView sessionID={selected} />
                )}
              </div>
            </>
          )}
        </section>
      </div>

      {/* 底部终端 */}
      {showTerminal ? (
        <div style={{ height: 220, borderTop: "1px solid #333" }}>
          <TerminalPanel />
        </div>
      ) : null}
    </main>
  )
}
