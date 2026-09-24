import { describe, test, expect } from "bun:test"
import {
  detectCacheDrift,
  cacheDriftFromUsage,
  trackCacheDrift,
  CACHE_DRIFT_PERCENT_THRESHOLD,
  CACHE_DRIFT_TOKEN_THRESHOLD,
} from "./cache-anchor"

describe("detectCacheDrift", () => {
  test("returns null cleanly when there is no baseline yet", () => {
    expect(detectCacheDrift({ prevCacheRead: undefined, curCacheRead: 10_000, prevInputTokens: 20_000 })).toBeNull()
    expect(detectCacheDrift({ prevCacheRead: 0, curCacheRead: 10_000, prevInputTokens: 20_000 })).toBeNull()
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
    expect(detectCacheDrift({ prevCacheRead: 30_000, curCacheRead: 29_000, prevInputTokens: 40_000 })).toBeNull()
  })

  test("does not flag when drop is under 5% even if >2K tokens", () => {
    expect(detectCacheDrift({ prevCacheRead: 1_000_000, curCacheRead: 990_000, prevInputTokens: 1_100_000 })).toBeNull()
  })

  test("flags when both thresholds met", () => {
    const r = detectCacheDrift({ prevCacheRead: 50_000, curCacheRead: 40_000, prevInputTokens: 60_000 })
    expect(r).not.toBeNull()
    expect(r?.percentDrop).toBeCloseTo((10_000 / 60_000) * 100, 0) // 16.67%
    expect(r?.droppedTokens).toBe(10_000)
  })

  test("uses prevInputTokens as baseline when available", () => {
    // prevCacheRead=10000, prevInputTokens=5000 (different from cache read)
    const r = detectCacheDrift({ prevCacheRead: 10_000, curCacheRead: 5_000, prevInputTokens: 5_000 })
    expect(r).not.toBeNull()
    expect(r?.percentDrop).toBeCloseTo((5_000 / 5_000) * 100, 0) // 100%
  })
})

describe("cacheDriftFromUsage", () => {
  test("returns null when no prev", () => {
    expect(cacheDriftFromUsage(undefined, { cacheRead: 1000, inputTokens: 2000 })).toBeNull()
    expect(cacheDriftFromUsage({ cacheRead: undefined, inputTokens: 1000 }, { cacheRead: 1000, inputTokens: 2000 })).toBeNull()
    expect(cacheDriftFromUsage({ cacheRead: 0, inputTokens: 1000 }, { cacheRead: 1000, inputTokens: 2000 })).toBeNull()
  })

  test("detects drift from usage objects", () => {
    const result = cacheDriftFromUsage(
      { cacheRead: 10000, inputTokens: 10000 },
      { cacheRead: 5000, inputTokens: 8000 }
    )
    expect(result).not.toBeNull()
    expect(result?.percentDrop).toBe(50)
    expect(result?.droppedTokens).toBe(5000)
    expect(result?.prevCacheRead).toBe(10000)
  })

  test("returns null when cache read increased", () => {
    expect(cacheDriftFromUsage(
      { cacheRead: 5000, inputTokens: 10000 },
      { cacheRead: 8000, inputTokens: 12000 }
    )).toBeNull()
  })
})

describe("trackCacheDrift（会话级跨消息检测）", () => {
  test("会话首条消息无基线 → null，但写入 anchor 供下条比较", () => {
    const anchor = new Map<string, { cacheRead: number; inputTokens: number }>()
    expect(trackCacheDrift(anchor, "s1", { cacheRead: 0, inputTokens: 100_000 })).toBeNull()
    expect(anchor.get("s1")).toEqual({ cacheRead: 0, inputTokens: 100_000 })
  })

  test("跨消息骤降可检出（旧口径单 step prev=0 恒漏检）", () => {
    const anchor = new Map<string, { cacheRead: number; inputTokens: number }>()
    trackCacheDrift(anchor, "s1", { cacheRead: 100_000, inputTokens: 120_000 })
    const r = trackCacheDrift(anchor, "s1", { cacheRead: 80_000, inputTokens: 130_000 })
    expect(r).not.toBeNull()
    expect(r?.droppedTokens).toBe(20_000)
    expect(r?.prevCacheRead).toBe(100_000)
  })

  test("跨消息稳定/增长不告警", () => {
    const anchor = new Map<string, { cacheRead: number; inputTokens: number }>()
    trackCacheDrift(anchor, "s1", { cacheRead: 100_000, inputTokens: 120_000 })
    expect(trackCacheDrift(anchor, "s1", { cacheRead: 100_500, inputTokens: 121_000 })).toBeNull()
  })

  test("不同会话锚点互不干扰", () => {
    const anchor = new Map<string, { cacheRead: number; inputTokens: number }>()
    trackCacheDrift(anchor, "s1", { cacheRead: 100_000, inputTokens: 120_000 })
    expect(trackCacheDrift(anchor, "s2", { cacheRead: 0, inputTokens: 50_000 })).toBeNull()
    expect(trackCacheDrift(anchor, "s1", { cacheRead: 70_000, inputTokens: 130_000 })).not.toBeNull()
  })

  test("anchor 有界：超上限淘汰最旧会话", () => {
    const anchor = new Map<string, { cacheRead: number; inputTokens: number }>()
    for (let i = 0; i < 1001; i++) trackCacheDrift(anchor, `s${i}`, { cacheRead: 1, inputTokens: 1 })
    expect(anchor.size).toBeLessThanOrEqual(1000)
    expect(anchor.has("s0")).toBe(false)
  })
})

describe("thresholds", () => {
  test("thresholds are exported with correct values", () => {
    expect(CACHE_DRIFT_PERCENT_THRESHOLD).toBe(5)
    expect(CACHE_DRIFT_TOKEN_THRESHOLD).toBe(2000)
  })
})