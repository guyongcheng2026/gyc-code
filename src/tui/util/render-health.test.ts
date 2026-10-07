import { describe, expect, it } from "bun:test"
import { RenderHealthMonitor } from "./render-health"

describe("RenderHealthMonitor", () => {
  it("keeps stats history bounded and returns newest last", () => {
    const m = new RenderHealthMonitor({ capacity: 3, now: () => 1_000 })
    m.push({ fps: 60, frameCount: 10, avgFrameMs: 4 })
    m.push({ fps: 59, frameCount: 20, avgFrameMs: 5 })
    m.push({ fps: 58, frameCount: 30, avgFrameMs: 6 })
    m.push({ fps: 57, frameCount: 40, avgFrameMs: 7 })
    const h = m.history()
    expect(h.length).toBe(3)
    expect(h[2]!.fps).toBe(57)
    expect(h[2]!.avgFrameMs).toBe(7)
  })

  it("stamps each sample with the injected clock", () => {
    const m = new RenderHealthMonitor({ capacity: 4, now: () => 42 })
    m.push({ fps: 60, frameCount: 1, avgFrameMs: 4 })
    expect(m.history()[0]!.at).toBe(42)
  })

  it("reports trend direction between oldest and newest sample", () => {
    const m = new RenderHealthMonitor({ capacity: 8, now: () => 0 })
    m.push({ fps: 60, frameCount: 10, avgFrameMs: 4 })
    m.push({ fps: 40, frameCount: 20, avgFrameMs: 12 })
    expect(m.trend()).toEqual({ fpsDelta: -20, avgFrameMsDelta: 8 })
  })

  it("returns undefined trend with fewer than two samples", () => {
    const m = new RenderHealthMonitor({ capacity: 8, now: () => 0 })
    expect(m.trend()).toBeUndefined()
    m.push({ fps: 60, frameCount: 1, avgFrameMs: 4 })
    expect(m.trend()).toBeUndefined()
  })

  it("counts render errors and survives a reset", () => {
    const m = new RenderHealthMonitor({ capacity: 4, now: () => 0 })
    m.noteError()
    m.noteError()
    m.noteError()
    expect(m.errors()).toBe(3)
    m.reset()
    expect(m.errors()).toBe(0)
    expect(m.history().length).toBe(0)
  })

  it("never grows history beyond capacity under sustained pushes", () => {
    const m = new RenderHealthMonitor({ capacity: 16, now: () => 0 })
    for (let i = 0; i < 500; i++) m.push({ fps: 60, frameCount: i, avgFrameMs: 4 })
    expect(m.history().length).toBe(16)
  })

  it("coerces a zero or negative capacity to one so history never stalls", () => {
    const m = new RenderHealthMonitor({ capacity: 0, now: () => 0 })
    m.push({ fps: 60, frameCount: 1, avgFrameMs: 4 })
    m.push({ fps: 60, frameCount: 2, avgFrameMs: 4 })
    expect(m.history().length).toBe(1)
  })

  it("defaults capacity to 32 when not provided", () => {
    const m = new RenderHealthMonitor({ now: () => 0 })
    for (let i = 0; i < 100; i++) m.push({ fps: 60, frameCount: i, avgFrameMs: 4 })
    expect(m.history().length).toBe(32)
  })
})

describe("RenderHealthMonitor 渲染错误限频", () => {
  it("只放行窗口内第一条同类错误，其余计入 suppressed", () => {
    let t = 0
    const m = new RenderHealthMonitor({ now: () => t, errorLogWindowMs: 60_000 })
    expect(m.shouldLogError("boom")).toBe(true)
    expect(m.shouldLogError("boom")).toBe(false)
    expect(m.shouldLogError("boom")).toBe(false)
    expect(m.suppressedErrors()).toBe(2)
  })

  it("不同错误键互不影响，各自放行一条", () => {
    const m = new RenderHealthMonitor({ now: () => 0, errorLogWindowMs: 60_000 })
    expect(m.shouldLogError("boom")).toBe(true)
    expect(m.shouldLogError("other")).toBe(true)
    expect(m.shouldLogError("boom")).toBe(false)
  })

  it("窗口滑过后重新放行，计数仍是上次落库以来累计的抑制数", () => {
    let t = 0
    const m = new RenderHealthMonitor({ now: () => t, errorLogWindowMs: 1_000 })
    expect(m.shouldLogError("boom")).toBe(true)
    expect(m.shouldLogError("boom")).toBe(false)
    expect(m.suppressedErrors()).toBe(1)
    t = 1_001
    // 放行这一刻读到的计数，就是日志行里 suppressed=N 要写的值。
    expect(m.shouldLogError("boom")).toBe(true)
    expect(m.suppressedErrors()).toBe(1)
    m.shouldLogError("boom")
    m.shouldLogError("boom")
    expect(m.shouldLogError("boom")).toBe(false)
    t = 2_002
    expect(m.shouldLogError("boom")).toBe(true)
    // 累计 4 条：上一次放行后的 1 条 + 本轮 3 条（两次显式调用 + 上面那次断言）
    expect(m.suppressedErrors()).toBe(4)
  })

  it("限频表有界，长跑不会无限增长", () => {
    const m = new RenderHealthMonitor({ now: () => 0, errorLogWindowMs: 60_000, errorKeyLimit: 8 })
    for (let i = 0; i < 500; i++) m.shouldLogError(`boom-${i}`)
    expect(m.trackedErrorKeys()).toBe(8)
  })
})

describe("RenderHealthMonitor 渲染错误突发熔断", () => {
  it("窗口内错误未达阈值时不熔断", () => {
    let t = 0
    const m = new RenderHealthMonitor({ now: () => t, errorBurstThreshold: 30, errorBurstWindowMs: 60_000 })
    for (let i = 0; i < 29; i++) {
      m.noteError()
      t += 10
    }
    expect(m.exceedsBurstThreshold()).toBe(false)
  })

  it("持续错误达到阈值即熔断（60fps 下约半秒）", () => {
    let t = 0
    const m = new RenderHealthMonitor({ now: () => t, errorBurstThreshold: 30, errorBurstWindowMs: 60_000 })
    for (let i = 0; i < 30; i++) {
      m.noteError()
      t += 16
    }
    expect(m.exceedsBurstThreshold()).toBe(true)
  })

  it("零星错误随时间滑出窗口后不再熔断", () => {
    let t = 0
    const m = new RenderHealthMonitor({ now: () => t, errorBurstThreshold: 30, errorBurstWindowMs: 60_000 })
    for (let i = 0; i < 29; i++) {
      m.noteError()
      t += 1_000
    }
    expect(m.exceedsBurstThreshold()).toBe(false)
  })

  it("reset 同时清空突发窗口与限频表", () => {
    const m = new RenderHealthMonitor({ now: () => 0, errorBurstThreshold: 2, errorBurstWindowMs: 60_000 })
    m.noteError()
    m.noteError()
    expect(m.exceedsBurstThreshold()).toBe(true)
    m.reset()
    expect(m.exceedsBurstThreshold()).toBe(false)
    expect(m.trackedErrorKeys()).toBe(0)
  })
})