import { describe, expect, it } from "bun:test"
import { createStreamingState } from "./streaming-state"

// 假定时器：可推进虚拟时钟
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
    get size() {
      return pending.size
    },
  }
}

describe("createStreamingState", () => {
  it("初始为空闲态", () => {
    const t = fakeTimers()
    const state = createStreamingState({ setTimeout: t.setTimeout, clearTimeout: t.clearTimeout })
    expect(state.value()).toBe(false)
    state.dispose()
  })

  it("升档立即生效", () => {
    const t = fakeTimers()
    const changes: boolean[] = []
    const state = createStreamingState({
      setTimeout: t.setTimeout,
      clearTimeout: t.clearTimeout,
      onChange: (v) => changes.push(v),
    })
    state.update(true)
    expect(state.value()).toBe(true)
    expect(changes).toEqual([true])
    state.dispose()
  })

  it("降档需持续到保持期才提交", () => {
    const t = fakeTimers()
    const state = createStreamingState({
      holdMs: 300,
      setTimeout: t.setTimeout,
      clearTimeout: t.clearTimeout,
    })
    state.update(true)
    state.update(false)
    expect(state.value()).toBe(true)
    t.advance(299)
    expect(state.value()).toBe(true)
    t.advance(1)
    expect(state.value()).toBe(false)
    state.dispose()
  })

  it("同一降档目标的重复更新不推迟降档", () => {
    const t = fakeTimers()
    const state = createStreamingState({
      holdMs: 300,
      setTimeout: t.setTimeout,
      clearTimeout: t.clearTimeout,
    })
    state.update(true)
    state.update(false)
    t.advance(200)
    state.update(false)
    t.advance(200)
    expect(state.value()).toBe(false)
    state.dispose()
  })

  it("降档保持期内重新流式会取消降档", () => {
    const t = fakeTimers()
    const state = createStreamingState({
      holdMs: 300,
      setTimeout: t.setTimeout,
      clearTimeout: t.clearTimeout,
    })
    state.update(true)
    state.update(false)
    t.advance(100)
    state.update(true)
    t.advance(1000)
    expect(state.value()).toBe(true)
    expect(t.size).toBe(0)
    state.dispose()
  })

  it("工具步骤边界的瞬时翻转不会降档", () => {
    const t = fakeTimers()
    const state = createStreamingState({
      holdMs: 300,
      setTimeout: t.setTimeout,
      clearTimeout: t.clearTimeout,
    })
    state.update(true)
    // 边界翻转：短暂空闲后又立刻流式
    state.update(false)
    state.update(true)
    t.advance(1000)
    expect(state.value()).toBe(true)
    state.dispose()
  })

  it("卸载后不再提交降档", () => {
    const t = fakeTimers()
    const changes: boolean[] = []
    const state = createStreamingState({
      holdMs: 300,
      setTimeout: t.setTimeout,
      clearTimeout: t.clearTimeout,
      onChange: (v) => changes.push(v),
    })
    state.update(true)
    state.update(false)
    state.dispose()
    t.advance(1000)
    expect(changes).toEqual([true])
    expect(state.value()).toBe(true)
  })
})
