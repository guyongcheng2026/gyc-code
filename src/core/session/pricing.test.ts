import { describe, expect, test } from "bun:test"
import { costForStep, pickCostTier, priceTokens, resolvePrice, type CostTier, type Price } from "./pricing"

/**
 * C-06：此前 v1 侧 getUsage 与 core 侧 costForStep 各写了一份计价，档位边界与
 * reasoning 计价方式都可能分叉，于是同一步算出两个成本，stats 自己对不上账。
 * 这里锁住共享实现的行为；两侧同源由「都委托 pricing.ts」保证，由本文件兜底。
 */

const base: Price = { input: 3, output: 15, cache: { read: 0.3, write: 3.75 } }
const longContext: CostTier = { input: 6, output: 22.5, tier: { type: "context", size: 200_000 } }

const tokens = (input: number, output: number, reasoning = 0, read = 0, write = 0) => ({
  input,
  output,
  reasoning,
  cache: { read, write },
})

describe("pickCostTier 档位选取", () => {
  test("未越过阈值时留在基准档", () => {
    expect(pickCostTier([base, longContext], 100_000)).toBe(base)
  })

  test("越过阈值后切到加价档", () => {
    expect(pickCostTier([base, longContext], 250_000)).toBe(longContext)
  })

  test("恰好等于阈值不切档 —— 边界语义必须两侧一致", () => {
    // 旧 core 侧是 contextTokens <= tier.size 则跳过，v1 侧是 contextTokens > size 才选。
    // 写成 < 就会在整 200k 处差一档，成本凭空翻倍。
    expect(pickCostTier([base, longContext], 200_000)).toBe(base)
  })

  test("多档时取越过阈值的最高档", () => {
    const mid: CostTier = { input: 4, output: 18, tier: { type: "context", size: 100_000 } }
    expect(pickCostTier([base, mid, longContext], 50_000)).toBe(base)
    expect(pickCostTier([base, mid, longContext], 150_000)).toBe(mid)
    expect(pickCostTier([base, mid, longContext], 900_000)).toBe(longContext)
  })

  test("空档位返回 undefined，而不是悄悄落到 0 价", () => {
    expect(pickCostTier([], 1000)).toBeUndefined()
  })

  test("缺 tier 字段的条目被忽略，不会被当成加价档", () => {
    expect(pickCostTier([base], 999_999)).toBe(base)
  })
})

describe("resolvePrice 单价选取", () => {
  test("有 tiers 时按上下文择优", () => {
    // models.dev 的实际形状：tiers 与基准单价并存（tiers[0] 即基准档）
    expect(resolvePrice({ ...base, tiers: [base, longContext] }, 300_000)).toEqual(longContext)
    expect(resolvePrice({ ...base, tiers: [base, longContext] }, 100_000)).toEqual(base)
  })

  test("无 tiers 但越过 200k 时回退 experimentalOver200K", () => {
    const cost = { ...base, experimentalOver200K: { input: 6, output: 22.5 } }
    expect(resolvePrice(cost, 300_000)).toEqual(cost.experimentalOver200K)
    // 未越过 200k：回落到基准价本身，而不是 undefined —— 模型总有基准单价
    expect(resolvePrice(cost, 100_000)).toEqual(base)
  })

  test("无价格数据返回 undefined —— cost 为 0 不等于免费", () => {
    expect(resolvePrice(undefined, 1000)).toBeUndefined()
  })
})

describe("priceTokens 计价", () => {
  test("reasoning 按 output 单价计，而非 input 单价", () => {
    // 1M reasoning：按 output($15) 应收 15；按 input($3) 只会收 3，系统性低估 5 倍
    expect(priceTokens(tokens(0, 0, 1_000_000), base)).toBeCloseTo(15, 10)
  })

  test("缓存读写各有独立单价，缺省为 0", () => {
    expect(priceTokens(tokens(1_000_000, 0, 0, 1_000_000, 1_000_000), base)).toBeCloseTo(3 + 0.3 + 3.75, 10)
    expect(priceTokens(tokens(1_000_000, 0, 0, 1_000_000, 1_000_000), { input: 1, output: 1 })).toBeCloseTo(1, 10)
  })

  test("无价格数据时收 0，但不会被当成已计价", () => {
    expect(priceTokens(tokens(1_000_000, 1_000_000), undefined)).toBe(0)
  })

  test("负数与 NaN token 被归零，不产生负成本", () => {
    const cost = priceTokens(tokens(-5, Number.NaN, 0), base)
    expect(cost).toBe(0)
    expect(Number.isFinite(cost)).toBe(true)
  })
})

describe("costForStep 组合路径", () => {
  test("同一 usage 在不同上下文规模下给出不同成本（长上下文加价生效）", () => {
    const small = costForStep(tokens(100_000, 0, 0, 50_000), [base, longContext])
    const large = costForStep(tokens(250_000, 0, 0), [base, longContext])
    expect(small).not.toBeCloseTo(large, 10)
  })

  test("传单个 Price 时不做档位判断", () => {
    expect(costForStep(tokens(1_000_000, 1_000_000), base)).toBeCloseTo(18, 10)
  })

  test("无价格输入时为 0", () => {
    expect(costForStep(tokens(1_000_000, 0), undefined)).toBe(0)
  })

  test("C-06：档位数组与等价单价的直算结果一致", () => {
    // 走 [base, longContext] 且已越过阈值时，必须与直接用 longContext 单价算出同一个数。
    // 两份实现分叉时，这个等式最先崩。
    const t = tokens(250_000, 1_000, 0, 10_000, 1_000)
    expect(costForStep(t, [base, longContext])).toBeCloseTo(priceTokens(t, longContext), 10)
  })
})
