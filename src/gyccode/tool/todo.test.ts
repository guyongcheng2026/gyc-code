import { describe, expect, it } from "bun:test"
import { Effect } from "effect"
import { buildTodoOutput } from "./todo"

describe("buildTodoOutput", () => {
  it("appends a verification reminder when 3+ todos are closed without a verify step", () => {
    const prev = [
      { content: "a", status: "in_progress", priority: "high" },
      { content: "b", status: "in_progress", priority: "medium" },
      { content: "c", status: "in_progress", priority: "low" },
    ]
    const next = [
      { content: "a", status: "completed", priority: "high" },
      { content: "b", status: "completed", priority: "medium" },
      { content: "c", status: "completed", priority: "low" },
    ]
    const out = buildTodoOutput({ prev: prev as any, next: next as any })
    expect(out).toContain("Todos updated")
    expect(out.toLowerCase()).toContain("verif")
  })

  it("omits the reminder when fewer than 3 todos are closed", () => {
    const prev = [
      { content: "a", status: "in_progress", priority: "high" },
      { content: "b", status: "in_progress", priority: "medium" },
    ]
    const next = [
      { content: "a", status: "completed", priority: "high" },
      { content: "b", status: "completed", priority: "medium" },
    ]
    const out = buildTodoOutput({ prev: prev as any, next: next as any })
    expect(out).toBe("Todos updated.")
  })

  it("omits the reminder when a remaining todo mentions verification", () => {
    const prev = [
      { content: "a", status: "in_progress", priority: "high" },
      { content: "b", status: "in_progress", priority: "medium" },
      { content: "c", status: "in_progress", priority: "low" },
    ]
    const next = [
      { content: "a", status: "completed", priority: "high" },
      { content: "b", status: "completed", priority: "medium" },
      { content: "c", status: "completed", priority: "low" },
      { content: "run tests to verify", status: "pending", priority: "high" },
    ]
    const out = buildTodoOutput({ prev: prev as any, next: next as any })
    expect(out).toBe("Todos updated.")
  })
})
