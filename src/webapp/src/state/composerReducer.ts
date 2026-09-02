/**
 * Composer State Reducer
 *
 * Manages the compose mode UI state including todo dock, permission dock,
 * question dock, and revert dock. Inspired by mimo-code's session-composer-state.ts
 * but adapted for React + TypeScript (gyccode webapp).
 */

// =============================================================================
// Types
// =============================================================================

export type TodoState = {
  visible: boolean
  items: TodoItem[]
}

export type TodoItem = {
  id: string
  text: string
  status: "pending" | "in_progress" | "completed" | "failed"
  subagentId?: string
}

export type PermissionState = {
  visible: boolean
  requests: PermissionRequest[]
}

export type PermissionRequest = {
  id: string
  tool: string
  input: Record<string, unknown>
  sessionID: string
  messageID: string
  partID: string
}

export type QuestionState = {
  visible: boolean
  questions: QuestionRequest[]
}

export type QuestionRequest = {
  id: string
  question: string
  options?: string[]
  sessionID: string
  messageID: string
  partID: string
}

export type RevertState = {
  visible: boolean
  changes: RevertChange[]
}

export type RevertChange = {
  id: string
  file: string
  additions: number
  deletions: number
}

export type ComposerState = {
  todo: TodoState
  permission: PermissionState
  question: QuestionState
  revert: RevertState
}

// =============================================================================
// Actions
// =============================================================================

type ComposerAction =
  // Todo actions
  | { type: "todo.show" }
  | { type: "todo.hide" }
  | { type: "todo.clear" }
  | { type: "todo.open" }
  | { type: "todo.close" }
  | { type: "todo.item.add"; item: TodoItem }
  | { type: "todo.item.update"; id: string; updates: Partial<TodoItem> }
  | { type: "todo.item.remove"; id: string }
  // Permission actions
  | { type: "permission.show" }
  | { type: "permission.hide" }
  | { type: "permission.request.add"; request: PermissionRequest }
  | { type: "permission.request.resolve"; id: string; approved: boolean }
  | { type: "permission.request.remove"; id: string }
  // Question actions
  | { type: "question.show" }
  | { type: "question.hide" }
  | { type: "question.request.add"; request: QuestionRequest }
  | { type: "question.request.resolve"; id: string; answer: string }
  | { type: "question.request.remove"; id: string }
  // Revert actions
  | { type: "revert.show" }
  | { type: "revert.hide" }
  | { type: "revert.change.add"; change: RevertChange }
  | { type: "revert.change.remove"; id: string }
  | { type: "revert.clear" }

// =============================================================================
// Initial State
// =============================================================================

export const initialComposerState = (): ComposerState => ({
  todo: { visible: false, items: [] },
  permission: { visible: false, requests: [] },
  question: { visible: false, questions: [] },
  revert: { visible: false, changes: [] },
})

// =============================================================================
// Reducer
// =============================================================================

export function composerReducer(state: ComposerState, action: ComposerAction): ComposerState {
  switch (action.type) {
    // ── Todo ──────────────────────────────────────────────────────────────
    case "todo.show":
      return { ...state, todo: { ...state.todo, visible: true } }
    case "todo.hide":
      return { ...state, todo: { ...state.todo, visible: false } }
    case "todo.clear":
      return { ...state, todo: { ...state.todo, items: [] } }
    case "todo.open":
      return { ...state, todo: { ...state.todo, visible: true } }
    case "todo.close":
      return { ...state, todo: { ...state.todo, visible: false } }
    case "todo.item.add":
      return { ...state, todo: { ...state.todo, items: [...state.todo.items, action.item] } }
    case "todo.item.update":
      return {
        ...state,
        todo: {
          ...state.todo,
          items: state.todo.items.map((item) =>
            item.id === action.id ? { ...item, ...action.updates } : item,
          ),
        },
      }
    case "todo.item.remove":
      return {
        ...state,
        todo: { ...state.todo, items: state.todo.items.filter((item) => item.id !== action.id) },
      }

    // ── Permission ────────────────────────────────────────────────────────
    case "permission.show":
      return { ...state, permission: { ...state.permission, visible: true } }
    case "permission.hide":
      return { ...state, permission: { ...state.permission, visible: false } }
    case "permission.request.add":
      return {
        ...state,
        permission: {
          ...state.permission,
          visible: true,
          requests: [...state.permission.requests, action.request],
        },
      }
    case "permission.request.resolve":
      return {
        ...state,
        permission: {
          ...state.permission,
          requests: state.permission.requests.filter((r) => r.id !== action.id),
          visible: state.permission.requests.length > 1,
        },
      }
    case "permission.request.remove":
      return {
        ...state,
        permission: {
          ...state.permission,
          requests: state.permission.requests.filter((r) => r.id !== action.id),
          visible: state.permission.requests.length > 1,
        },
      }

    // ── Question ──────────────────────────────────────────────────────────
    case "question.show":
      return { ...state, question: { ...state.question, visible: true } }
    case "question.hide":
      return { ...state, question: { ...state.question, visible: false } }
    case "question.request.add":
      return {
        ...state,
        question: {
          ...state.question,
          visible: true,
          questions: [...state.question.questions, action.request],
        },
      }
    case "question.request.resolve":
      return {
        ...state,
        question: {
          ...state.question,
          questions: state.question.questions.filter((q) => q.id !== action.id),
          visible: state.question.questions.length > 1,
        },
      }
    case "question.request.remove":
      return {
        ...state,
        question: {
          ...state.question,
          questions: state.question.questions.filter((q) => q.id !== action.id),
          visible: state.question.questions.length > 1,
        },
      }

    // ── Revert ────────────────────────────────────────────────────────────
    case "revert.show":
      return { ...state, revert: { ...state.revert, visible: true } }
    case "revert.hide":
      return { ...state, revert: { ...state.revert, visible: false } }
    case "revert.change.add":
      return {
        ...state,
        revert: {
          ...state.revert,
          visible: true,
          changes: [...state.revert.changes, action.change],
        },
      }
    case "revert.change.remove":
      return {
        ...state,
        revert: {
          ...state.revert,
          changes: state.revert.changes.filter((c) => c.id !== action.id),
        },
      }
    case "revert.clear":
      return { ...state, revert: { ...state.revert, changes: [] } }

    default:
      return state
  }
}

// =============================================================================
// Helpers
// =============================================================================

/** Check if any dock is visible (for layout adjustments). */
export function hasVisibleDock(state: ComposerState): boolean {
  return state.todo.visible || state.permission.visible || state.question.visible || state.revert.visible
}

/** Get the count of pending permission requests. */
export function pendingPermissionCount(state: ComposerState): number {
  return state.permission.requests.length
}

/** Get the count of pending questions. */
export function pendingQuestionCount(state: ComposerState): number {
  return state.question.questions.length
}

/** Get todo progress (completed / total). */
export function todoProgress(state: ComposerState): { completed: number; total: number } {
  const total = state.todo.items.length
  const completed = state.todo.items.filter((item) => item.status === "completed").length
  return { completed, total }
}
