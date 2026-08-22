import { describe, expect, it } from "bun:test"
import { sortTodos, splitTodos } from "./todo"

const item = (status: string, content: string) => ({ status, content, priority: "medium" })

describe("sortTodos", () => {
  it("puts in_progress before pending before completed", () => {
    const sorted = sortTodos([item("completed", "a"), item("in_progress", "b"), item("pending", "c")])
    expect(sorted.map((t) => t.status)).toEqual(["in_progress", "pending", "completed"])
  })

  it("is stable for equal statuses", () => {
    const sorted = sortTodos([item("pending", "x"), item("pending", "y")])
    expect(sorted.map((t) => t.content)).toEqual(["x", "y"])
  })
})

describe("splitTodos", () => {
  it("keeps active tasks and shows a recent-done tail", () => {
    const done = Array.from({ length: 5 }, (_, i) => item("completed", `done ${i}`))
    const active = [item("in_progress", "active")]
    const parts = splitTodos([...done, ...active])
    expect(parts.active.map((t) => t.content)).toEqual(["active"])
    expect(parts.visibleDone).toHaveLength(3)
    expect(parts.hiddenDoneCount).toBe(2)
  })

  it("excludes cancelled tasks from active", () => {
    const parts = splitTodos([item("cancelled", "no"), item("pending", "yes")])
    expect(parts.active.map((t) => t.content)).toEqual(["yes"])
  })
})