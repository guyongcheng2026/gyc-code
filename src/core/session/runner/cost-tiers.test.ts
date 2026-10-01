import { describe, expect, test } from "bun:test"
import { costForStep, pickCostTier, type CostTier } from "./publish-llm-event"

const base: CostTier = { input: 1.25, output: 10, cache: { read: 0.125, write: 0 } }
const longContext: CostTier = {
  input: 2.5,
  output: 20,
  cache: { read: 0.25, write: 0 },
  tier: { type: "context", size: 200_000 },
}

const tokens = (input: number, output = 0, cacheRead = 0, cacheWrite = 0) => ({
  input,
  output,
  reasoning: 0,
  cache: { read: cacheRead, write: cacheWrite },
})

describe("C-06 长上下文档位必须被真正用上", () => {
  test("上下文未超阈值时用基础档", () => {
    expect(pickCostTier([base, longContext], 100_000)).toBe(base)
  })

  test("上下文超过阈值时切到加价档", () => {
    expect(pickCostTier([base, longContext], 250_000)).toBe(longContext)
  })

  test("多档时取满足条件的最高档", () => {
    const mid: CostTier = { input: 1.8, output: 14, tier: { type: "context", size: 100_000 } }
    expect(pickCostTier([base, mid, longContext], 50_000)).toBe(base)
    expect(pickCostTier([base, mid, longContext], 150_000)).toBe(mid)
    expect(pickCostTier([base, mid, longContext], 900_000)).toBe(longContext)
  })

  test("恰好等于阈值不算超限", () => {
    expect(pickCostTier([base, longContext], 200_000)).toBe(base)
  })

  test("无档位或空表安全回退", () => {
    expect(pickCostTier([], 1000)).toBeUndefined()
    expect(pickCostTier([base], 999_999)).toBe(base)
  })

  test("costForStep 对同一 usage 按上下文档位给出不同成本", () => {
    const small = costForStep(tokens(100_000, 0, 50_000), [base, longContext])
    const large = costForStep(tokens(250_000, 0, 0), [base, longContext])
    // 25 万输入全走加价档，10 万+5 万命中则走基础档
    expect(large).toBeCloseTo((250_000 * 2.5) / 1_000_000, 10)
    expect(small).toBeCloseTo((100_000 * 1.25) / 1_000_000 + (50_000 * 0.125) / 1_000_000, 10)
    expect(large).toBeGreaterThan(small)
  })

  test("单档 Price 传入时行为不变（向后兼容）", () => {
    expect(costForStep(tokens(1_000_000, 1_000_000), { input: 2, output: 4, cache: { read: 1, write: 1 } })).toBeCloseTo(
      2 + 4 + 0 + 0,
      10,
    )
  })

  test("缺 cache 单价时按 0 计，不产生 NaN", () => {
    const value = costForStep(tokens(1_000_000, 0, 1_000_000, 1_000_000), { input: 1, output: 1 })
    expect(Number.isFinite(value)).toBe(true)
  })
})