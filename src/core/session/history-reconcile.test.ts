import { describe, expect, test } from "bun:test"
import { reconcileInterruptedTools } from "./history"

// U-3：会话进程被 SIGKILL 后，tool part 可能永远停留在 running/pending。
// reconcileInterruptedTools 在会话加载出口把这类残留统一改写为 error。
// fixture 一律用工厂函数，避免用例间共享可变对象。

const runningPart = () => ({
  type: "tool",
  id: "t1",
  name: "bash",
  state: { status: "running", input: { cmd: "ls" }, structured: {}, content: [] },
})

const pendingPart = () => ({
  type: "tool",
  id: "t2",
  name: "edit",
  state: { status: "pending", input: "raw-call" },
})

const completedPart = () => ({
  type: "tool",
  id: "t3",
  name: "read",
  state: { status: "completed", input: {}, structured: {}, content: [] },
})

const errorPart = () => ({
  type: "tool",
  id: "t4",
  name: "grep",
  state: { status: "error", input: {}, structured: {}, content: [], error: "boom" },
})

const textPart = () => ({ type: "text", text: "hi" })

const asst = (content: unknown[]) =>
  ({
    id: "m1",
    type: "assistant",
    agent: "build",
    model: { providerID: "p", id: "m" },
    content,
    time: { created: new Date() },
  }) as any

describe("reconcileInterruptedTools", () => {
  test("running → error，保留 input/structured/content", () => {
    const msgs = [asst([runningPart()])]
    expect(reconcileInterruptedTools(msgs as any)).toBe(1)
    const st = (msgs[0] as any).content[0].state
    expect(st.status).toBe("error")
    expect(st.input).toEqual({ cmd: "ls" })
    expect(st.structured).toEqual({})
    expect(st.content).toEqual([])
    expect(st.error.message).toContain("进程中断")
  })

  test("pending → error，rawInput 保全进 structured", () => {
    const msgs = [asst([pendingPart()])]
    expect(reconcileInterruptedTools(msgs as any)).toBe(1)
    const st = (msgs[0] as any).content[0].state
    expect(st.status).toBe("error")
    expect(st.structured.rawInput).toBe("raw-call")
    expect(st.error.message).toContain("进程中断")
  })

  test("completed/error 与非 tool part 不动", () => {
    const msgs = [asst([completedPart(), errorPart(), textPart()])]
    expect(reconcileInterruptedTools(msgs as any)).toBe(0)
    expect((msgs[0] as any).content[0].state.status).toBe("completed")
    expect((msgs[0] as any).content[1].state.error).toBe("boom")
  })

  test("非 assistant 消息不动", () => {
    const msgs = [{ id: "u1", type: "user" }, { id: "c1", type: "compaction" }]
    expect(reconcileInterruptedTools(msgs as any)).toBe(0)
  })

  test("重复调用幂等（第二次 0 改动）", () => {
    const msgs = [asst([runningPart(), pendingPart()])]
    expect(reconcileInterruptedTools(msgs as any)).toBe(2)
    expect(reconcileInterruptedTools(msgs as any)).toBe(0)
  })
})