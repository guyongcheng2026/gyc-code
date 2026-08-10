import { describe, expect, it } from "bun:test"
import { usable } from "./overflow"

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