import { useState } from "react"

/**
 * 计划条（对齐 DSH TodoDock/TodoPanel）：
 * - 列表为空时自我隐藏
 * - 默认折叠；表头显示标题 + `·` 连接的各状态计数（省略零计数）
 */
export function TodoPanel({ todos }: { todos: { content: string; done?: boolean }[] }) {
  const [open, setOpen] = useState(false)
  if (todos.length === 0) return null

  const done = todos.filter((t) => t.done).length
  const pending = todos.length - done
  const counts = [done > 0 ? `${done} 已完成` : "", pending > 0 ? `${pending} 待处理` : ""]
    .filter(Boolean)
    .join(" · ")

  return (
    <div className="todo-panel">
      <button className="todo-panel-header" onClick={() => setOpen((v) => !v)} aria-expanded={open}>
        <span className="todo-panel-icon">☑</span>
        <span className="todo-panel-title">当前计划</span>
        {counts ? <span className="todo-panel-counts">{counts}</span> : null}
        <span style={{ flex: 1 }} />
        <span className="disclosure-chevron" style={{ transform: open ? "rotate(90deg)" : "none" }}>
          ›
        </span>
      </button>
      {open ? (
        <ul className="todo-panel-list">
          {todos.map((t, idx) => (
            <li key={idx} className={t.done ? "todo-item todo-item-done" : "todo-item"}>
              <span className="todo-item-box">{t.done ? "✓" : ""}</span>
              <span className="todo-item-text">{t.content}</span>
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  )
}
