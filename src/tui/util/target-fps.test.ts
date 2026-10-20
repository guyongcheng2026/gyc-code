import { describe, expect, it } from "bun:test"
import { createFpsController } from "./target-fps"

// 用假定时器驱动，避免真实等待
function fakeTimers() {
  let seq = 0
  let now = 0
  const pending = new Map<number, { fn: () => void; at: number }>()
  return {
    setTimeout: ((fn: () => void, ms?: number) => {
      const id = ++seq
      pending.set(id, { fn, at: now + (ms ?? 0) })
      return id as unknown as ReturnType<typeof setTimeout>
    }) as unknown as typeof setTimeout,
    clearTimeout: ((id: number) => {
      pending.delete(id)
    }) as unknown as typeof clearTimeout,
    // 推进虚拟时钟：只触发到期（at <= now + ms）的定时器，按到期先后排序
    advance(ms: number) {
      const deadline = now + ms
      for (;;) {
        let dueId: number | undefined
        let dueAt = Number.POSITIVE_INFINITY
        for (const entry of pending) {
          if (entry[1].at <= deadline && entry[1].at < dueAt) {
            dueId = entry[0]
            dueAt = entry[1].at
          }
        }
        if (dueId === undefined) break
        const timer = pending.get(dueId)
        pending.delete(dueId)
        if (!timer) break
        now = timer.at
        timer.fn()
      }
      now = deadline
    },
    fireAll() {
      for (const entry of [...pending]) {
        pending.delete(entry[0])
        entry[1].fn()
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

  it("同一降档目标的重复请求不推迟降档（计时器不被无限重置）", () => {
    const t = fakeTimers()
    const applied: number[] = []
    const c = createFpsController((fps) => applied.push(fps), {
      downgradeDelayMs: 3000,
      setTimeout: t.setTimeout,
      clearTimeout: t.clearTimeout,
    })
    c.request(60, true)
    // 持续空闲：每 2s 一次同样的降档请求（间隔 < 降档延迟 3s）
    c.request(30, false)
    t.advance(2000)
    c.request(30, false)
    t.advance(2000)
    c.request(30, false)
    // 首个降档请求后满 3s：应已降到 30，而不是被后续请求无限推迟
    t.advance(1000)
    expect(applied).toEqual([60, 30])
    c.dispose()
  })

  it("降档目标改变时重新计时（从新请求起算）", () => {
    const t = fakeTimers()
    const applied: number[] = []
    const c = createFpsController((fps) => applied.push(fps), {
      downgradeDelayMs: 3000,
      setTimeout: t.setTimeout,
      clearTimeout: t.clearTimeout,
    })
    c.request(60, true)
    c.request(30, false)
    t.advance(1000)
    // 降档目标从 30 变成 20：旧计时器作废，新计时器从此刻起算（t=4000 触发）
    c.request(20, false)
    t.advance(2500)
    expect(applied).toEqual([60])
    t.advance(500)
    expect(applied).toEqual([60, 20])
    c.dispose()
  })

  it("升档后挂起的降档被取消（不得再触发多余 apply）", () => {
    const t = fakeTimers()
    const applied: number[] = []
    const c = createFpsController((fps) => applied.push(fps), {
      downgradeDelayMs: 3000,
      setTimeout: t.setTimeout,
      clearTimeout: t.clearTimeout,
    })
    c.request(60, true)
    c.request(30, false)
    // 升档必须取消挂起的降档计时器
    c.request(60, true)
    t.fireAll()
    expect(applied).toEqual([60])
    expect(t.size).toBe(0)
    c.dispose()
  })

  it("多 subagent 并行：流式与空闲交替不误降档", () => {
    const t = fakeTimers()
    const applied: number[] = []
    const c = createFpsController((fps) => applied.push(fps), {
      downgradeDelayMs: 3000,
      setTimeout: t.setTimeout,
      clearTimeout: t.clearTimeout,
    })
    // 主 agent 持续流式（60），subagent 空闲（30），两类请求交替到达
    const requests: Array<[number, boolean]> = [
      [60, true],
      [30, false],
      [60, true],
      [30, false],
      [60, true],
    ]
    for (const request of requests) {
      c.request(request[0], request[1])
      t.advance(1000)
    }
    // 全程只有升档：既没有降档，也没有遗留的挂起降档
    t.fireAll()
    expect(applied).toEqual([60])
    expect(t.size).toBe(0)
    c.dispose()
  })

  it("renderScale 跨档：流式期目标下移立即生效（非降档变化）", () => {
    const t = fakeTimers()
    const applied: number[] = []
    const c = createFpsController((fps) => applied.push(fps), {
      downgradeDelayMs: 3000,
      setTimeout: t.setTimeout,
      clearTimeout: t.clearTimeout,
    })
    c.request(60, true)
    // 长会话把渲染预算从 60 压到 20：仍在流式，属非降档变化，应立即生效
    c.request(20, true)
    expect(applied).toEqual([60, 20])
    t.fireAll()
    expect(applied).toEqual([60, 20])
    c.dispose()
  })
})
