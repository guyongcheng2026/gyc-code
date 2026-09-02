import { describe, expect, test } from "vitest"
import {
  composerReducer,
  initialComposerState,
  hasVisibleDock,
  todoProgress,
  pendingPermissionCount,
  pendingQuestionCount,
  type TodoItem,
  type PermissionRequest,
  type QuestionRequest,
  type RevertChange,
} from "./composerReducer"

describe("composerReducer", () => {
  // ── Todo ──────────────────────────────────────────────────────────────────

  describe("todo", () => {
    test("initial state has empty todo", () => {
      const state = initialComposerState()
      expect(state.todo.visible).toBe(false)
      expect(state.todo.items).toEqual([])
    })

    test("todo.show sets visible to true", () => {
      const state = initialComposerState()
      const next = composerReducer(state, { type: "todo.show" })
      expect(next.todo.visible).toBe(true)
    })

    test("todo.hide sets visible to false", () => {
      const state = initialComposerState()
      state.todo.visible = true
      const next = composerReducer(state, { type: "todo.hide" })
      expect(next.todo.visible).toBe(false)
    })

    test("todo.clear removes all items", () => {
      const state = initialComposerState()
      state.todo.items = [{ id: "1", text: "task 1", status: "pending" }]
      const next = composerReducer(state, { type: "todo.clear" })
      expect(next.todo.items).toEqual([])
    })

    test("todo.item.add adds item", () => {
      const state = initialComposerState()
      const item: TodoItem = { id: "1", text: "task 1", status: "pending" }
      const next = composerReducer(state, { type: "todo.item.add", item })
      expect(next.todo.items).toHaveLength(1)
      expect(next.todo.items[0]).toEqual(item)
    })

    test("todo.item.update updates item", () => {
      const state = initialComposerState()
      state.todo.items = [{ id: "1", text: "task 1", status: "pending" }]
      const next = composerReducer(state, {
        type: "todo.item.update",
        id: "1",
        updates: { status: "completed" },
      })
      expect(next.todo.items[0].status).toBe("completed")
    })

    test("todo.item.remove removes item", () => {
      const state = initialComposerState()
      state.todo.items = [{ id: "1", text: "task 1", status: "pending" }]
      const next = composerReducer(state, { type: "todo.item.remove", id: "1" })
      expect(next.todo.items).toHaveLength(0)
    })
  })

  // ── Permission ────────────────────────────────────────────────────────────

  describe("permission", () => {
    test("initial state has empty permission", () => {
      const state = initialComposerState()
      expect(state.permission.visible).toBe(false)
      expect(state.permission.requests).toEqual([])
    })

    test("permission.request.add sets visible and adds request", () => {
      const state = initialComposerState()
      const request: PermissionRequest = {
        id: "1",
        tool: "bash",
        input: { command: "ls" },
        sessionID: "s1",
        messageID: "m1",
        partID: "p1",
      }
      const next = composerReducer(state, { type: "permission.request.add", request })
      expect(next.permission.visible).toBe(true)
      expect(next.permission.requests).toHaveLength(1)
    })

    test("permission.request.resolve removes request and hides if last", () => {
      const state = initialComposerState()
      state.permission.requests = [
        { id: "1", tool: "bash", input: {}, sessionID: "s1", messageID: "m1", partID: "p1" },
      ]
      state.permission.visible = true
      const next = composerReducer(state, { type: "permission.request.resolve", id: "1", approved: true })
      expect(next.permission.requests).toHaveLength(0)
      expect(next.permission.visible).toBe(false)
    })

    test("permission.request.resolve keeps visible if more requests", () => {
      const state = initialComposerState()
      state.permission.requests = [
        { id: "1", tool: "bash", input: {}, sessionID: "s1", messageID: "m1", partID: "p1" },
        { id: "2", tool: "write", input: {}, sessionID: "s1", messageID: "m1", partID: "p2" },
      ]
      state.permission.visible = true
      const next = composerReducer(state, { type: "permission.request.resolve", id: "1", approved: true })
      expect(next.permission.requests).toHaveLength(1)
      expect(next.permission.visible).toBe(true)
    })
  })

  // ── Question ──────────────────────────────────────────────────────────────

  describe("question", () => {
    test("initial state has empty question", () => {
      const state = initialComposerState()
      expect(state.question.visible).toBe(false)
      expect(state.question.questions).toEqual([])
    })

    test("question.request.add sets visible and adds question", () => {
      const state = initialComposerState()
      const request: QuestionRequest = {
        id: "1",
        question: "Which framework?",
        options: ["React", "Vue"],
        sessionID: "s1",
        messageID: "m1",
        partID: "p1",
      }
      const next = composerReducer(state, { type: "question.request.add", request })
      expect(next.question.visible).toBe(true)
      expect(next.question.questions).toHaveLength(1)
    })

    test("question.request.resolve removes question and hides if last", () => {
      const state = initialComposerState()
      state.question.questions = [
        { id: "1", question: "Which?", sessionID: "s1", messageID: "m1", partID: "p1" },
      ]
      state.question.visible = true
      const next = composerReducer(state, { type: "question.request.resolve", id: "1", answer: "React" })
      expect(next.question.questions).toHaveLength(0)
      expect(next.question.visible).toBe(false)
    })
  })

  // ── Revert ────────────────────────────────────────────────────────────────

  describe("revert", () => {
    test("initial state has empty revert", () => {
      const state = initialComposerState()
      expect(state.revert.visible).toBe(false)
      expect(state.revert.changes).toEqual([])
    })

    test("revert.change.add sets visible and adds change", () => {
      const state = initialComposerState()
      const change: RevertChange = {
        id: "1",
        file: "src/index.ts",
        additions: 10,
        deletions: 5,
      }
      const next = composerReducer(state, { type: "revert.change.add", change })
      expect(next.revert.visible).toBe(true)
      expect(next.revert.changes).toHaveLength(1)
    })

    test("revert.change.remove removes change", () => {
      const state = initialComposerState()
      state.revert.changes = [
        { id: "1", file: "src/index.ts", additions: 10, deletions: 5 },
      ]
      const next = composerReducer(state, { type: "revert.change.remove", id: "1" })
      expect(next.revert.changes).toHaveLength(0)
    })

    test("revert.clear removes all changes", () => {
      const state = initialComposerState()
      state.revert.changes = [
        { id: "1", file: "src/index.ts", additions: 10, deletions: 5 },
        { id: "2", file: "src/utils.ts", additions: 3, deletions: 1 },
      ]
      const next = composerReducer(state, { type: "revert.clear" })
      expect(next.revert.changes).toEqual([])
    })
  })
})

describe("helpers", () => {
  test("hasVisibleDock returns false when all hidden", () => {
    const state = initialComposerState()
    expect(hasVisibleDock(state)).toBe(false)
  })

  test("hasVisibleDock returns true when todo visible", () => {
    const state = initialComposerState()
    state.todo.visible = true
    expect(hasVisibleDock(state)).toBe(true)
  })

  test("hasVisibleDock returns true when permission visible", () => {
    const state = initialComposerState()
    state.permission.visible = true
    expect(hasVisibleDock(state)).toBe(true)
  })

  test("hasVisibleDock returns true when question visible", () => {
    const state = initialComposerState()
    state.question.visible = true
    expect(hasVisibleDock(state)).toBe(true)
  })

  test("hasVisibleDock returns true when revert visible", () => {
    const state = initialComposerState()
    state.revert.visible = true
    expect(hasVisibleDock(state)).toBe(true)
  })

  test("todoProgress calculates correctly", () => {
    const state = initialComposerState()
    state.todo.items = [
      { id: "1", text: "a", status: "completed" },
      { id: "2", text: "b", status: "pending" },
      { id: "3", text: "c", status: "completed" },
    ]
    expect(todoProgress(state)).toEqual({ completed: 2, total: 3 })
  })

  test("pendingPermissionCount counts correctly", () => {
    const state = initialComposerState()
    state.permission.requests = [
      { id: "1", tool: "bash", input: {}, sessionID: "s1", messageID: "m1", partID: "p1" },
      { id: "2", tool: "write", input: {}, sessionID: "s1", messageID: "m1", partID: "p2" },
    ]
    expect(pendingPermissionCount(state)).toBe(2)
  })

  test("pendingQuestionCount counts correctly", () => {
    const state = initialComposerState()
    state.question.questions = [
      { id: "1", question: "a", sessionID: "s1", messageID: "m1", partID: "p1" },
    ]
    expect(pendingQuestionCount(state)).toBe(1)
  })
})
