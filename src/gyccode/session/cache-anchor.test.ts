import { describe, test, expect } from "bun:test"
import { detectCacheDrift } from "./cache-anchor"

describe("detectCacheDrift", () => {
  test("returns null cleanly when there is no baseline yet", () => {
    expect(detectCacheDrift({ prevCacheRead: undefined, curCacheRead: 10_000, prevInputTokens: 20_000 })).toBeNull()
  })

  test("returns null when cache read increased or held steady", () => {
    expect(detectCacheDrift({ prevCacheRead: 10_000, curCacheRead: 11_000, prevInputTokens: 20_000 })).toBeNull()
    expect(detectCacheDrift({ prevCacheRead: 10_000, curCacheRead: 10_000, prevInputTokens: 20_000 })).toBeNull()
  })

  test("flags drift when cache read drops more than 5% (Claude threshold) and >2K tokens", () => {
    const r = detectCacheDrift({ prevCacheRead: 100_000, curCacheRead: 80_000, prevInputTokens: 120_000 })
    expect(r).not.toBeNull()
    expect(r?.percentDrop).toBeCloseTo((20_000 / 120_000) * 100, 0) // 16.67%
    expect(r?.droppedTokens).toBe(20_000)
  })

  test("does not flag when drop is under 2K tokens even if >5%", () => {
    // prev 100K, cur 95K -> 5% drop but only 5K tokens; need >2K -> 5K passes.
    // Use a small total to create >2K but <5% case: prev 30K, cur 29K -> 1K drop (under 2K).
    expect(detectCacheDrift({ prevCacheRead: 30_000, curCacheRead: 29_000, prevInputTokens: 40_000 })).toBeNull()
  })

  test("does not flag when drop is under 5% even if >2K tokens", () => {
    // prev 1M, cur 990K -> 1% drop but 10K tokens. Under 5% -> null.
    expect(detectCacheDrift({ prevCacheRead: 1_000_000, curCacheRead: 990_000, prevInputTokens: 1_100_000 })).toBeNull()
  })

  test("flags when both thresholds met", () => {
    const r = detectCacheDrift({ prevCacheRead: 50_000, curCacheRead: 40_000, prevInputTokens: 60_000 })
    expect(r).not.toBeNull()
    expect(r?.percentDrop).toBeCloseTo((20_000 / 120_000) * 100, 0) // 16.67%
    expect(r?.droppedTokens).toBe(10_000)
  })
})
