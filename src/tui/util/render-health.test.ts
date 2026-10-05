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