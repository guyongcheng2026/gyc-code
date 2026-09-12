import { describe, expect, it } from "bun:test"
import { goalStatus } from "./goal"

describe("goalStatus", () => {
  it("returns undefined with no verdict", () => {
    expect(goalStatus(undefined)).toBeUndefined()
  })

  it("reports error when the judge errored", () => {
    const s = goalStatus({ ok: false, error: true, reason: "boom", attempt: 1 })
    expect(s?.kind).toBe("error")
    expect(s?.label).toContain("已停止")
  })

  it("reports met when the condition is satisfied", () => {
    const s = goalStatus({ ok: true, reason: "done", attempt: 2 })
    expect(s?.kind).toBe("met")
    expect(s?.label).toBe("已达成")
  })

  it("reports impossible when the condition cannot be met", () => {
    const s = goalStatus({ ok: false, impossible: true, reason: "nope", attempt: 3 })
    expect(s?.kind).toBe("impossible")
  })

  it("reports pending with the round number when not met yet", () => {
    const s = goalStatus({ ok: false, reason: "still going", attempt: 4 })
    expect(s?.kind).toBe("pending")
    expect(s?.label).toContain("第 4 轮")
  })
})

describe("session.goal adapter contract", () => {
  it("exposes a per-session goal getter backed by the sync store", () => {
    const store: {
      session_goal: Record<
        string,
        | {
            condition: string
            lastVerdict?: { ok: boolean; impossible?: boolean; error?: boolean; reason: string; attempt: number }
          }
        | undefined
      >
    } = { session_goal: { s1: { condition: "write tests", lastVerdict: { ok: true, reason: "done", attempt: 1 } } } }
    const session = {
      goal: (id: string) => store.session_goal[id],
    }
    expect(session.goal("s1")?.condition).toBe("write tests")
    expect(session.goal("s1")?.lastVerdict?.ok).toBe(true)
    expect(session.goal("missing")).toBeUndefined()
  })
})