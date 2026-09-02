/**
 * Composer Region Component
 *
 * Unified dock area for compose mode, integrating todo dock, permission dock,
 * question dock, and revert dock. Inspired by mimo-code's session-composer-region.tsx
 * but adapted for React + TypeScript (gyccode webapp).
 */

import { useReducer, useCallback, type ReactNode } from "react"
import {
  composerReducer,
  initialComposerState,
  hasVisibleDock,
  todoProgress,
  pendingPermissionCount,
  pendingQuestionCount,
  type ComposerState,
  type TodoItem,
  type PermissionRequest,
  type QuestionRequest,
  type RevertChange,
} from "../state/composerReducer"

// =============================================================================
// Context
// =============================================================================

export type ComposerContextValue = {
  state: ComposerState
  dispatch: React.Dispatch<Parameters<typeof composerReducer>[1]>
}

// =============================================================================
// Sub-components
// =============================================================================

// ── Todo Dock ────────────────────────────────────────────────────────────────

function TodoDock({
  state,
  dispatch,
}: {
  state: ComposerState["todo"]
  dispatch: React.Dispatch<Parameters<typeof composerReducer>[1]>
}) {
  if (state.items.length === 0) return null

  const { completed, total } = todoProgress({ todo: state } as ComposerState)
  const counts = [completed > 0 ? `${completed} 完成` : "", total - completed > 0 ? `${total - completed} 待做` : ""]
    .filter(Boolean)
    .join(" · ")

  return (
    <div className="composer-dock composer-todo-dock">
      <button
        className="composer-dock-header"
        onClick={() => dispatch({ type: state.visible ? "todo.close" : "todo.open" })}
        aria-expanded={state.visible}
      >
        <span className="composer-dock-icon">☑</span>
        <span className="composer-dock-title">计划任务</span>
        {counts ? <span className="composer-dock-counts">{counts}</span> : null}
        <span style={{ flex: 1 }} />
        <span className="composer-dock-chevron" style={{ transform: state.visible ? "rotate(90deg)" : "none" }}>
          ›
        </span>
      </button>
      {state.visible ? (
        <ul className="composer-dock-list">
          {state.items.map((item) => (
            <li
              key={item.id}
              className={`composer-dock-item composer-dock-item-${item.status}`}
            >
              <span className="composer-dock-item-status">
                {item.status === "completed" ? "✓" : item.status === "in_progress" ? "◉" : item.status === "failed" ? "✗" : "○"}
              </span>
              <span className="composer-dock-item-text">{item.text}</span>
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  )
}

// ── Permission Dock ──────────────────────────────────────────────────────────

function PermissionDock({
  state,
  dispatch,
  onApprove,
  onDeny,
}: {
  state: ComposerState["permission"]
  dispatch: React.Dispatch<Parameters<typeof composerReducer>[1]>
  onApprove?: (id: string) => void
  onDeny?: (id: string) => void
}) {
  if (state.requests.length === 0) return null

  const current = state.requests[0]
  const pending = state.requests.length

  return (
    <div className="composer-dock composer-permission-dock">
      <div className="composer-dock-header">
        <span className="composer-dock-icon">🔒</span>
        <span className="composer-dock-title">权限请求</span>
        {pending > 1 ? <span className="composer-dock-counts">{pending} 个待处理</span> : null}
        <span style={{ flex: 1 }} />
        <button
          className="composer-dock-close"
          onClick={() => dispatch({ type: "permission.hide" })}
          aria-label="收起"
        >
          ×
        </button>
      </div>
      <div className="composer-dock-content">
        <div className="composer-permission-tool">{current.tool}</div>
        <pre className="composer-permission-input">{JSON.stringify(current.input, null, 2)}</pre>
        <div className="composer-permission-actions">
          <button
            className="composer-btn composer-btn-approve"
            onClick={() => {
              onApprove?.(current.id)
              dispatch({ type: "permission.request.resolve", id: current.id, approved: true })
            }}
          >
            允许
          </button>
          <button
            className="composer-btn composer-btn-deny"
            onClick={() => {
              onDeny?.(current.id)
              dispatch({ type: "permission.request.resolve", id: current.id, approved: false })
            }}
          >
            拒绝
          </button>
        </div>
      </div>
    </div>
  )
}

// ── Question Dock ────────────────────────────────────────────────────────────

function QuestionDock({
  state,
  dispatch,
  onAnswer,
}: {
  state: ComposerState["question"]
  dispatch: React.Dispatch<Parameters<typeof composerReducer>[1]>
  onAnswer?: (id: string, answer: string) => void
}) {
  if (state.questions.length === 0) return null

  const current = state.questions[0]
  const pending = state.questions.length

  return (
    <div className="composer-dock composer-question-dock">
      <div className="composer-dock-header">
        <span className="composer-dock-icon">❓</span>
        <span className="composer-dock-title">问题</span>
        {pending > 1 ? <span className="composer-dock-counts">{pending} 个待回答</span> : null}
        <span style={{ flex: 1 }} />
        <button
          className="composer-dock-close"
          onClick={() => dispatch({ type: "question.hide" })}
          aria-label="收起"
        >
          ×
        </button>
      </div>
      <div className="composer-dock-content">
        <div className="composer-question-text">{current.question}</div>
        {current.options && current.options.length > 0 ? (
          <div className="composer-question-options">
            {current.options.map((option, idx) => (
              <button
                key={idx}
                className="composer-btn composer-btn-option"
                onClick={() => {
                  onAnswer?.(current.id, option)
                  dispatch({ type: "question.request.resolve", id: current.id, answer: option })
                }}
              >
                {option}
              </button>
            ))}
          </div>
        ) : null}
      </div>
    </div>
  )
}

// ── Revert Dock ──────────────────────────────────────────────────────────────

function RevertDock({
  state,
  dispatch,
  onRevert,
}: {
  state: ComposerState["revert"]
  dispatch: React.Dispatch<Parameters<typeof composerReducer>[1]>
  onRevert?: (changeIds: string[]) => void
}) {
  if (state.changes.length === 0) return null

  return (
    <div className="composer-dock composer-revert-dock">
      <div className="composer-dock-header">
        <span className="composer-dock-icon">↩</span>
        <span className="composer-dock-title">可回退变更</span>
        <span className="composer-dock-counts">{state.changes.length} 个文件</span>
        <span style={{ flex: 1 }} />
        <button
          className="composer-dock-close"
          onClick={() => dispatch({ type: "revert.hide" })}
          aria-label="收起"
        >
          ×
        </button>
      </div>
      {state.visible ? (
        <>
          <ul className="composer-dock-list">
            {state.changes.map((change) => (
              <li key={change.id} className="composer-dock-item composer-dock-item-revert">
                <span className="composer-dock-item-text">{change.file}</span>
                <span className="composer-dock-item-meta">
                  <span className="composer-revert-add">+{change.additions}</span>
                  <span className="composer-revert-del">-{change.deletions}</span>
                </span>
              </li>
            ))}
          </ul>
          <div className="composer-dock-actions">
            <button
              className="composer-btn composer-btn-revert-all"
              onClick={() => {
                onRevert?.(state.changes.map((c) => c.id))
                dispatch({ type: "revert.clear" })
              }}
            >
              全部回退
            </button>
          </div>
        </>
      ) : null}
    </div>
  )
}

// =============================================================================
// Main Component
// =============================================================================

export type ComposerRegionProps = {
  children?: ReactNode
  onPermissionApprove?: (id: string) => void
  onPermissionDeny?: (id: string) => void
  onQuestionAnswer?: (id: string, answer: string) => void
  onRevert?: (changeIds: string[]) => void
}

export function ComposerRegion({
  children,
  onPermissionApprove,
  onPermissionDeny,
  onQuestionAnswer,
  onRevert,
}: ComposerRegionProps) {
  const [state, dispatch] = useReducer(composerReducer, null, initialComposerState)
  const visible = hasVisibleDock(state)

  return (
    <div className={`composer-region ${visible ? "composer-region-active" : ""}`}>
      {visible ? (
        <div className="composer-docks">
          <TodoDock state={state.todo} dispatch={dispatch} />
          <PermissionDock
            state={state.permission}
            dispatch={dispatch}
            onApprove={onPermissionApprove}
            onDeny={onPermissionDeny}
          />
          <QuestionDock state={state.question} dispatch={dispatch} onAnswer={onQuestionAnswer} />
          <RevertDock state={state.revert} dispatch={dispatch} onRevert={onRevert} />
        </div>
      ) : null}
      <div className="composer-content">{children}</div>
    </div>
  )
}

// =============================================================================
// Hook for external control
// =============================================================================

export function useComposer() {
  const [state, dispatch] = useReducer(composerReducer, null, initialComposerState)

  const addTodo = useCallback(
    (item: TodoItem) => dispatch({ type: "todo.item.add", item }),
    [dispatch],
  )
  const updateTodo = useCallback(
    (id: string, updates: Partial<TodoItem>) => dispatch({ type: "todo.item.update", id, updates }),
    [dispatch],
  )
  const removeTodo = useCallback(
    (id: string) => dispatch({ type: "todo.item.remove", id }),
    [dispatch],
  )
  const addPermission = useCallback(
    (request: PermissionRequest) => dispatch({ type: "permission.request.add", request }),
    [dispatch],
  )
  const addQuestion = useCallback(
    (request: QuestionRequest) => dispatch({ type: "question.request.add", request }),
    [dispatch],
  )
  const addRevertChange = useCallback(
    (change: RevertChange) => dispatch({ type: "revert.change.add", change }),
    [dispatch],
  )

  return {
    state,
    dispatch,
    addTodo,
    updateTodo,
    removeTodo,
    addPermission,
    addQuestion,
    addRevertChange,
  }
}
