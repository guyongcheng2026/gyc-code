import { describe, expect, it } from "bun:test"
import { Effect } from "effect"
import { parseDefinition, transitionAfterStep, type StepOutcome } from "./state"
import type { WorkflowDef, WorkflowRunStep, WorkflowStepDef } from "@gyccode/schema/workflow"

const run = <A, E>(effect: Effect.Effect<A, E>) => Effect.runPromise(effect)

const step = (overrides: Partial<WorkflowStepDef> = {}): WorkflowStepDef => ({
  id: "s1",
  name: "步骤一",
  prompt: "执行任务一",
  ...overrides,
})

const def = (steps: WorkflowStepDef[]): WorkflowDef => ({ name: "demo", steps })

const runSteps = (states: Array<Partial<WorkflowRunStep> & { stepId: string }>): WorkflowRunStep[] =>
  states.map((s) => ({ status: "pending", retries: 0, ...s }))

describe("parseDefinition 定义解析", () => {
  it("合法 JSON 定义解析成功", async () => {
    const d = await run(
      parseDefinition("demo", JSON.stringify({ name: "demo", description: "示例", steps: [{ id: "a", name: "A", prompt: "do" }] })),
    )
    expect(d.name).toBe("demo")
    expect(d.steps).toHaveLength(1)
    expect(d.steps[0]!.id).toBe("a")
  })

  it("JSONC 尾逗号与注释可解析", async () => {
    const d = await run(parseDefinition("demo", `{\r\n  // 注释\r\n  "name": "demo",\r\n  "steps": [{ "id": "a", "name": "A", "prompt": "do" },]\r\n}`))
    expect(d.steps).toHaveLength(1)
  })

  it("缺省 name 用文件名补齐", async () => {
    const d = await run(parseDefinition("feature", JSON.stringify({ steps: [] })))
    expect(d.name).toBe("feature")
  })

  it("空内容返回解析失败", async () => {
    const err = await run(parseDefinition("demo", "").pipe(Effect.flip))
    expect(err.message).toContain("demo")
    expect(err.message).toContain("解析失败")
  })

  it("null 内容返回为空错误", async () => {
    const err = await run(parseDefinition("demo", "null").pipe(Effect.flip))
    expect(err.message).toContain("demo")
    expect(err.message).toContain("为空")
  })

  it("非法 JSON 返回解析失败", async () => {
    const err = await run(parseDefinition("demo", "{ not json").pipe(Effect.flip))
    expect(err.message).toContain("解析失败")
  })

  it("结构无效（缺 prompt）返回结构错误", async () => {
    const err = await run(parseDefinition("demo", JSON.stringify({ steps: [{ id: "a", name: "A" }] })).pipe(Effect.flip))
    expect(err.message).toContain("结构无效")
  })
})

describe("transitionAfterStep 状态机", () => {
  const NOW = 1000

  it("成功：标记 done 并推进", () => {
    const t = transitionAfterStep(
      { steps: runSteps([{ stepId: "a" }, { stepId: "b" }]), index: 0, stepDef: step({ id: "a" }), def: def([step({ id: "a" }), step({ id: "b" })]), outcome: { ok: true, summary: "完成" } },
      NOW,
    )
    expect(t.kind).toBe("next")
    if (t.kind !== "next") return
    expect(t.currentStepIndex).toBe(1)
    expect(t.steps[0]).toMatchObject({ status: "done", summary: "完成", timeEnded: NOW })
    expect(t.steps[1]!.status).toBe("pending")
  })

  it("失败未达 retry 上限：原地重试并递增次数", () => {
    const t = transitionAfterStep(
      { steps: runSteps([{ stepId: "a" }, { stepId: "b" }]), index: 0, stepDef: step({ id: "a", retry: 2 }), def: def([step({ id: "a" }), step({ id: "b" })]), outcome: { ok: false, error: "失败" } },
      NOW,
    )
    expect(t.kind).toBe("retry")
    if (t.kind !== "retry") return
    expect(t.steps[0]).toMatchObject({ status: "pending", retries: 1 })
  })

  it("失败达上限且默认 stop：终止失败", () => {
    const t = transitionAfterStep(
      { steps: runSteps([{ stepId: "a", retries: 1 }, { stepId: "b" }]), index: 0, stepDef: step({ id: "a", retry: 1 }), def: def([step({ id: "a" }), step({ id: "b" })]), outcome: { ok: false, error: "失败" } },
      NOW,
    )
    expect(t.kind).toBe("fail")
    if (t.kind !== "fail") return
    expect(t.error).toBe("失败")
    expect(t.steps[0]).toMatchObject({ status: "failed", retries: 1, error: "失败", timeEnded: NOW })
  })

  it("失败达上限且 continue：标记 failed 后继续下一步", () => {
    const t = transitionAfterStep(
      { steps: runSteps([{ stepId: "a" }, { stepId: "b" }]), index: 0, stepDef: step({ id: "a", onFailure: "continue" }), def: def([step({ id: "a" }), step({ id: "b" })]), outcome: { ok: false, error: "失败" } },
      NOW,
    )
    expect(t.kind).toBe("next")
    if (t.kind !== "next") return
    expect(t.currentStepIndex).toBe(1)
    expect(t.steps[0]).toMatchObject({ status: "failed" })
  })

  it("失败达上限且跳转到指定步骤：中间步骤标记 skipped", () => {
    const t = transitionAfterStep(
      { steps: runSteps([{ stepId: "a" }, { stepId: "b" }, { stepId: "c" }]), index: 0, stepDef: step({ id: "a", onFailure: "c" }), def: def([step({ id: "a" }), step({ id: "b" }), step({ id: "c" })]), outcome: { ok: false, error: "失败" } },
      NOW,
    )
    expect(t.kind).toBe("jump")
    if (t.kind !== "jump") return
    expect(t.currentStepIndex).toBe(2)
    expect(t.steps[0]).toMatchObject({ status: "failed", error: "失败" })
    expect(t.steps[1]).toMatchObject({ status: "skipped", timeEnded: NOW })
  })

  it("跳转目标不存在：回退为终止失败", () => {
    const t = transitionAfterStep(
      { steps: runSteps([{ stepId: "a" }, { stepId: "b" }]), index: 0, stepDef: step({ id: "a", onFailure: "zzz" }), def: def([step({ id: "a" }), step({ id: "b" })]), outcome: { ok: false, error: "失败" } },
      NOW,
    )
    expect(t.kind).toBe("fail")
    if (t.kind !== "fail") return
    expect(t.steps[0]).toMatchObject({ status: "failed" })
  })
})