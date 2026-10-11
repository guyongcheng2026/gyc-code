import { describe, expect, it } from "bun:test"
import { createFpsController } from "./target-fps"

// 用假定时器驱动，避免真实等待
function fakeTimers() {
  let seq = 0
  const pending = new Map<number, () => void>()
  return {
    setTimeout: ((fn: () => void) => {
      const id = ++seq
      pending.set(id, fn)
      return id as unknown as ReturnType<typeof setTimeout>
    }) as unknown as typeof setTimeout,
    clearTimeout: ((id: number) => {
      pending.delete(id)
    }) as unknown as typeof clearTimeout,
    fireAll() {
      for (const [id, fn] of [...pending]) {
        pending.delete(id)
        fn()
      }
    },
    get size() {
      return pending.size
    },
  }
}

describe("createFpsController", () => {
  it("升档立即生效（不等待）", () => {
    const t = fakeTimers()
    const applied: number[] = []
    const c = createFpsController((fps) => applied.push(fps), { setTimeout: t.setTimeout, clearTimeout: t.clearTimeout })
    c.request(30, false)
    t.fireAll()
    c.request(60, true)
    expect(applied).toEqual([30, 60])
    c.dispose()
  })

  it("降档延迟生效（空闲持续后才应用）", () => {
    const t = fakeTimers()
    const applied: number[] = []
    const c = createFpsController((fps) => applied.push(fps), {
      downgradeDelayMs: 3000,
      setTimeout: t.setTimeout,
      clearTimeout: t.clearTimeout,
    })
    c.request(60, true)
    expect(applied).toEqual([60])
    c.request(30, false)
    // 未到时间：仍是 60
    expect(applied).toEqual([60])
    t.fireAll()
    expect(applied).toEqual([60, 30])
    c.dispose()
  })

  it("工具步骤边界的高频 pending 翻转不触发降档（抖动回归）", () => {
    const t = fakeTimers()
    const applied: number[] = []
    const c = createFpsController((fps) => applied.push(fps), {
      downgradeDelayMs: 3000,
      setTimeout: t.setTimeout,
      clearTimeout: t.clearTimeout,
    })
    // 模拟 agent 循环：step.started(流式) → step.ended(空闲) → 下一步 started(流式) …
    // 相邻步骤间隔远小于降档延迟，且末尾停在流式态（与真实循环一致）
    const steps = [true, false, true, false, true]
    for (const streaming of steps) {
      c.request(streaming ? 60 : 30, streaming)
    }
    // 只应看到一次升档，没有 30 的降档
    expect(applied).toEqual([60])
    c.dispose()
  })

  it("真正的空闲（持续超过延迟）才降档", () => {
    const t = fakeTimers()
    const applied: number[] = []
    const c = createFpsController((fps) => applied.push(fps), {
      downgradeDelayMs: 3000,
      setTimeout: t.setTimeout,
      clearTimeout: t.clearTimeout,
    })
    c.request(60, true)
    c.request(30, false)
    t.fireAll()
    expect(applied).toEqual([60, 30])
    c.dispose()
  })

  it("dispose 取消挂起的降档", () => {
    const t = fakeTimers()
    const applied: number[] = []
    const c = createFpsController((fps) => applied.push(fps), { setTimeout: t.setTimeout, clearTimeout: t.clearTimeout })
    c.request(60, true)
    c.request(30, false)
    c.dispose()
    t.fireAll()
    expect(applied).toEqual([60])
  })

  it("相同帧率不重复应用", () => {
    const t = fakeTimers()
    const applied: number[] = []
    const c = createFpsController((fps) => applied.push(fps), { setTimeout: t.setTimeout, clearTimeout: t.clearTimeout })
    c.request(60, true)
    c.request(60, true)
    c.request(60, true)
    expect(applied).toEqual([60])
    c.dispose()
  })
})
