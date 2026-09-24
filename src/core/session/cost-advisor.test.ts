// cacheOpportunityAdvice 误报回归防护（2026-09-24）：修复前 cacheRatio 恒为 0，
// 任何 >100K 输入会话都会收到「缓存未充分利用」提示——而稳态前缀命中实测可达
// 100%。判定接 store.costStats 聚合的 tokens_cache_read/write 后按真实比例评估。
import { describe, expect, test } from "bun:test"
import { cacheOpportunityAdvice } from "./cost-advisor"

const tokens = (input: number, read: number, write = 0) => ({ input, cache: { read, write } })

describe("cacheOpportunityAdvice", () => {
  test("高命中大输入不误报（原 bug：cacheRatio 恒 0 必误报）", () => {
    expect(cacheOpportunityAdvice(tokens(50_000, 940_000, 10_000))).toBeUndefined()
  })

  test("低命中且总输入 >100K 才提示", () => {
    const advice = cacheOpportunityAdvice(tokens(1_140_000, 60_000))
    expect(advice).toBeDefined()
    expect(advice!.type).toBe("cache_opportunity")
    expect(advice!.savings?.tokens).toBeGreaterThan(0)
  })

  test("低命中但规模不足 100K 不提示", () => {
    expect(cacheOpportunityAdvice(tokens(9_000, 500))).toBeUndefined()
  })

  test("全零输入返回 undefined", () => {
    expect(cacheOpportunityAdvice(tokens(0, 0))).toBeUndefined()
  })
})
