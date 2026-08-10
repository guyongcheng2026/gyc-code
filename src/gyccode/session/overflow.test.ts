import { describe, expect, it } from "bun:test"
import { usable, calculateTokenWarningState } from "./overflow"

const baseCfg: any = { compaction: {} }

describe("usable", () => {
  it("applies GYCCODE_MAX_CONTEXT_TOKENS cap when limit.input is set", () => {
    const model = { limit: { context: 1_000_000, input: 1_000_000, output: 128_000 } } as any
    // cap 500k; input branch: min(1M, 500k) - reserved(20k)
    const prev = process.env.GYCCODE_MAX_CONTEXT_TOKENS
    process.env.GYCCODE_MAX_CONTEXT_TOKENS = "500000"
    try {
      const u = usable({ cfg: baseCfg, model, outputTokenMax: 32_000 })
      expect(u).toBe(500_000 - 20_000)
    } finally {
      if (prev) process.env.GYCCODE_MAX_CONTEXT_TOKENS = prev
      else delete process.env.GYCCODE_MAX_CONTEXT_TOKENS
    }
  })

  it("returns 0 when context is 0", () => {
    const model = { limit: { context: 0, output: 32_000 } } as any
    expect(usable({ cfg: baseCfg, model, outputTokenMax: 32_000 })).toBe(0)
  })

  it("uses context branch when limit.input is absent", () => {
    const model = { limit: { context: 200_000, output: 64_000 } } as any
    const prev = process.env.GYCCODE_MAX_CONTEXT_TOKENS
    delete process.env.GYCCODE_MAX_CONTEXT_TOKENS
    try {
      const u = usable({ cfg: baseCfg, model, outputTokenMax: 32_000 })
      expect(u).toBe(200_000 - 32_000)
    } finally {
      if (prev) process.env.GYCCODE_MAX_CONTEXT_TOKENS = prev
    }
  })
})

describe("calculateTokenWarningState", () => {
  // Claude Code 分级阈值：warning buffer 20K（相对 usable）、error buffer 13K、
  // blocking 3K。usable = effective window - reserved。
  const model = { limit: { context: 200_000, output: 32_000 } } as any
  const cfg: any = { compaction: {} }

  it("returns blocking when usage exceeds usable - 3K", () => {
    const u = usable({ cfg, model, outputTokenMax: 32_000 }) // 200_000 - 32_000 = 168_000
    const s = calculateTokenWarningState({ used: u - 1_000, cfg, model, outputTokenMax: 32_000, limit: u })
    expect(s.percentLeft).toBeLessThan(100)
    expect(s.isAboveBlocking).toBe(true)
    expect(s.isAboveError).toBe(true)
    expect(s.isAboveWarning).toBe(true)
  })

  it("returns error only when usage crossed 13K buffer", () => {
    const u = usable({ cfg, model, outputTokenMax: 32_000 })
    // used below blocking (3K remaining) but above 13K remaining
    const used = u - 10_000
    const s = calculateTokenWarningState({ used, cfg, model, outputTokenMax: 32_000, limit: u })
    expect(s.isAboveBlocking).toBe(false)
    expect(s.isAboveError).toBe(true)
    expect(s.isAboveWarning).toBe(true)
  })

  it("returns warning only when usage crossed 20K buffer", () => {
    const u = usable({ cfg, model, outputTokenMax: 32_000 })
    const used = u - 18_000
    const s = calculateTokenWarningState({ used, cfg, model, outputTokenMax: 32_000, limit: u })
    expect(s.isAboveBlocking).toBe(false)
    expect(s.isAboveError).toBe(false)
    expect(s.isAboveWarning).toBe(true)
  })

  it("returns none when usage is comfortably below warning buffer", () => {
    const u = usable({ cfg, model, outputTokenMax: 32_000 })
    const used = u - 50_000
    const s = calculateTokenWarningState({ used, cfg, model, outputTokenMax: 32_000, limit: u })
    expect(s.isAboveBlocking).toBe(false)
    expect(s.isAboveError).toBe(false)
    expect(s.isAboveWarning).toBe(false)
    expect(s.percentLeft).toBeCloseTo((50_000 / u) * 100, 0)
  })

  it("caps percentLeft at 100 when used is 0", () => {
    const u = usable({ cfg, model, outputTokenMax: 32_000 })
    const s = calculateTokenWarningState({ used: 0, cfg, model, outputTokenMax: 32_000, limit: u })
    expect(s.percentLeft).toBe(100)
    expect(s.isAboveBlocking).toBe(false)
  })
})
