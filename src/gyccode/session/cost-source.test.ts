import { describe, expect, test } from "bun:test"
import { getUsage } from "./session"
import { Usage } from "@gyccode/llm"

/**
 * C-04：本地没有 provider 账单可拉（各家账单 API 形态不一且需外部凭据），
 * 因此对账的前提是「每个数字知道自己的来源」。copilot 的 totalNanoAiu 是
 * provider 侧返回的真实扣费，其余一律是按 models.dev 单价的本地估算。
 *
 * 来源标注错了，比没有来源更糟 —— 会让人拿估算值去当账单核销。
 */
describe("C-04 成本来源标注", () => {
  const model = {
    cost: { input: 3, output: 15, cache: { read: 0.3, write: 3.75 } },
  } as unknown as Parameters<typeof getUsage>[0]["model"]

  const usage = new Usage({ inputTokens: 1_000_000, outputTokens: 0 })

  test("无 provider 账单元数据时标为 estimated，且按本地单价算出成本", () => {
    const out = getUsage({ model, usage })
    expect(out.costSource).toBe("estimated")
    // input 1M × $3/M = $3；cache 读减记后 inputTokens 不再重复计入
    expect(out.cost).toBeGreaterThan(0)
  })

  test("copilot 返回真实扣费时标为 provider-reported，且优先于本地估算", () => {
    // totalNanoAiu 以 1e11 nano-AIU = $1 换算，故 $2.5 对应 2.5e11
    const out = getUsage({
      model,
      usage,
      metadata: { copilot: { totalNanoAiu: 250_000_000_000 } } as never,
    })
    expect(out.costSource).toBe("provider-reported")
    expect(out.cost).toBeCloseTo(2.5, 10)
  })

  test("totalNanoAiu 为负数或非有限值时不得当作权威数据，退回 estimated", () => {
    for (const bad of [-1, Number.NaN, Number.POSITIVE_INFINITY]) {
      const out = getUsage({ model, usage, metadata: { copilot: { totalNanoAiu: bad } } as never })
      expect(out.costSource).toBe("estimated")
    }
  })

  test("无单价数据的模型仍标 estimated —— cost 为 0 不等于免费", () => {
    const out = getUsage({ model: {} as never, usage: new Usage({ inputTokens: 5000 }) })
    expect(out.costSource).toBe("estimated")
    expect(out.cost).toBe(0)
  })
})