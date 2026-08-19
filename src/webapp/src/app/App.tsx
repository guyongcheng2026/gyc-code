import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import { useSessions } from "../client/useSessions"
import { useFileTree } from "../client/useFileTree"
import { useTheme } from "../client/useTheme"
import { useEvents } from "../client/useEvents"
import { sdk } from "../client/sdk"
import type { TreeNode } from "../state/fileTreeReducer"
import { SessionList } from "./SessionList"
import { ChatPanel } from "./ChatPanel"
import { FileTree } from "./FileTree"
import { FileViewer } from "./FileViewer"
import { DiffView } from "./DiffView"
import { Trajectory } from "./Trajectory"
import { TerminalPanel } from "./TerminalPanel"

type MainTab = "chat" | "diff" | "traj"

// 已加载文件树扁平化为路径列表（供 @ 引用触发）
function flattenTree(root: TreeNode[], children: Record<string, TreeNode[]>): string[] {
  const out: string[] = []
  const walk = (nodes: TreeNode[]) => {
    for (const n of nodes) {
      if (n.type === "file") out.push(n.path)
      const kids = children[n.path]
      if (kids) walk(kids)
    }
  }
  walk(root)
  return out
}

export function App() {
  const { sessions, reload, remove } = useSessions()
  const [selected, setSelected] = useState<string | null>(null)
  const [tab, setTab] = useState<MainTab>("chat")
  const [filePath, setFilePath] = useState<string | null>(null)
  const [showTerminal, setShowTerminal] = useState(true)
  const [query, setQuery] = useState("")
  const [busyMap, setBusyMap] = useState<Record<string, boolean>>({})
  // 待交互状态（对齐 DSH pendingInteraction）：琥珀点 = 等待审批/等待回答
  const [pendingMap, setPendingMap] = useState<Record<string, "permission" | "question" | undefined>>({})
  const [sidebarWidth, setSidebarWidth] = useState(260)
  const resizing = useRef(false)
  const tree = useFileTree()
  const { pref, cycle } = useTheme()

  // 会话运行状态（对齐 DSH 侧栏运行指示器）：事件驱动维护 busyMap + pendingMap
  useEvents(undefined, (e) => {
    const props = (e.properties ?? {}) as Record<string, unknown>
    const sid = (props.sessionID ?? props["sessionId"]) as string | undefined
    if (typeof sid !== "string") return
    if (e.type === "session.busy") setBusyMap((prev) => ({ ...prev, [sid]: true }))
    if (e.type === "session.idle") setBusyMap((prev) => ({ ...prev, [sid]: false }))
    if (e.type === "permission.updated") setPendingMap((prev) => ({ ...prev, [sid]: "permission" }))
    if (e.type === "permission.replied") setPendingMap((prev) => ({ ...prev, [sid]: undefined }))
    if (e.type === "question.v2.asked") setPendingMap((prev) => ({ ...prev, [sid]: "question" }))
    if (e.type === "question.v2.replied" || e.type === "question.v2.rejected")
      setPendingMap((prev) => ({ ...prev, [sid]: undefined }))
  })

  // 侧栏拖宽（对齐 DSH 拖动手柄，瞬态几何不持久化）
  const startResize = useCallback((e: React.MouseEvent) => {
    e.preventDefault()
    resizing.current = true
    const onMove = (ev: MouseEvent) => {
      if (!resizing.current) return
      setSidebarWidth(Math.min(420, Math.max(180, ev.clientX)))
    }
    const onUp = () => {
      resizing.current = false
      window.removeEventListener("mousemove", onMove)
      window.removeEventListener("mouseup", onUp)
      document.body.style.cursor = ""
    }
    document.body.style.cursor = "col-resize"
    window.addEventListener("mousemove", onMove)
    window.addEventListener("mouseup", onUp)
  }, [])

  // @ 引用可用的已加载文件路径
  const files = useMemo(() => flattenTree(tree.state.root, tree.state.children), [tree.state])

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

  // 侧栏会话搜索（对齐 DSH 折叠搜索：标题子串过滤）
  const q = query.trim().toLowerCase()
  const visibleSessions = q
    ? sessions.filter((s) => (s.title ?? s.id).toLowerCase().includes(q))
    : sessions

  const themeLabel = pref === "light" ? "☀️ 亮色" : pref === "dark" ? "🌙 深色" : "🖥️ 系统"

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
        {/* 左栏：会话（项目/线程）+ 文件 */}
        <aside
          className="sidebar"
          style={{
            display: "flex",
            flexDirection: "column",
            width: sidebarWidth,
            borderRight: "1px solid var(--border-subtle)",
            background: "var(--panel-bg)",
          }}
        >
          <div style={{ padding: 10, borderBottom: "1px solid var(--border-subtle)" }}>
            <button className="btn btn-primary" onClick={onNew} style={{ width: "100%", fontWeight: 600 }}>
              + 新会话
            </button>
          </div>
          <div style={{ borderBottom: "1px solid var(--border-subtle)", maxHeight: "40%", overflowY: "auto", padding: "4px 6px", display: "flex", flexDirection: "column" }}>
            <div style={{ display: "flex", alignItems: "center", padding: "6px 2px", gap: 6 }}>
              <div style={{ fontSize: 11, color: "var(--inactive)", letterSpacing: "0.05em", flex: 1 }}>线程</div>
              <input
                className="session-search"
                placeholder="搜索会话…"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
              />
            </div>
            <SessionList
              sessions={visibleSessions}
              selected={selected}
              busyMap={busyMap}
              pendingMap={pendingMap}
              onSelect={setSelected}
              onNew={onNew}
              onDelete={(id) => {
                if (id === selected) {
                  setSelected(null)
                  window.location.hash = ""
                }
                remove(id).catch(() => {})
              }}
            />
          </div>
          <div style={{ flex: 1, minHeight: 0, overflowY: "auto", padding: "4px 6px" }}>
            <div style={{ fontSize: 11, color: "var(--inactive)", padding: "6px 8px", letterSpacing: "0.05em" }}>
              项目
            </div>
            <FileTree state={tree.state} selected={filePath} onSelect={setFilePath} onToggle={tree.toggle} />
          </div>
          {/* 拖宽手柄：贴侧栏右缘的不可见命中条 */}
          <div className="sidebar-resize" onMouseDown={startResize} />
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
              gyc<span style={{ color: "var(--brand)" }}>·</span>web
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
                <button
                  className="btn btn-ghost"
                  style={{ opacity: tab === "traj" ? 1 : 0.55 }}
                  onClick={() => setTab("traj")}
                >
                  轨迹
                </button>
              </>
            ) : (
              <button className="btn btn-ghost" onClick={() => setFilePath(null)}>
                ← 返回
              </button>
            )}
            <button className="btn btn-ghost" style={{ marginLeft: "auto" }} onClick={cycle} title="亮色 → 深色 → 跟随系统">
              {themeLabel}
            </button>
            <button className="btn btn-ghost" onClick={() => setShowTerminal((v) => !v)}>
              {showTerminal ? "收起终端" : "展开终端"}
            </button>
          </div>

          {/* 居中内容（结果区居中，max-width） */}
          <div style={{ flex: 1, minHeight: 0, display: "flex", justifyContent: "center" }}>
            <div
              style={{
                width: "100%",
                maxWidth: filePath || tab !== "chat" ? "100%" : 760,
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
                  <ChatPanel sessionID={selected} files={files} />
                ) : (
                  <div style={{ flex: 1, display: "flex", alignItems: "center", justifyContent: "center", color: "var(--inactive)" }}>
                    选择或新建一个会话
                  </div>
                )
              ) : tab === "traj" ? (
                <div style={{ flex: 1, minHeight: 0 }}>
                  <Trajectory sessionID={selected} />
                </div>
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
