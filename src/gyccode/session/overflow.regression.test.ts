import { describe, expect, it } from "bun:test"
import { isOverflow } from "./overflow"

const makeModel = (context = 50000, inputLimit?: number): any => ({
  id: "test-model",
  providerID: "test-provider",
  limit: { context, input: inputLimit, output: 4096 },
  route: { defaults: { limits: { context, input: inputLimit, output: 4096 } } },
})

const makeCfg = (): any => ({ compaction: {} })

const makeTokens = (total: number, input: number, output: number): any => ({
  total,
  input,
  output,
  reasoning: 0,
  cache: { read: 0, write: 0 },
})

describe("session/overflow (P1 回归)", () => {
  it("P1 回归: total=0 不应误判为 overflow", () => {
    const model = makeModel(50000, 50000)
    const tokens = makeTokens(0, 5000, 5000)
    expect(isOverflow({ cfg: makeCfg(), tokens, model })).toBe(false)
  })

  it("total=0 且子字段和超过 context 时正确判定 overflow", () => {
    const model = makeModel(10000, 10000)
    const tokens = makeTokens(0, 6000, 6000)
    expect(isOverflow({ cfg: makeCfg(), tokens, model })).toBe(true)
  })

  it("auto=false 时直接返回 false", () => {
    const model = makeModel(100, 100)
    const tokens = makeTokens(999, 999, 0)
    expect(isOverflow({ cfg: { compaction: { auto: false } }, tokens, model })).toBe(false)
  })

  it("context=0 时不判定 overflow", () => {
    const model = makeModel(0)
    const tokens = makeTokens(9999, 0, 0)
    expect(isOverflow({ cfg: makeCfg(), tokens, model })).toBe(false)
  })

  it("total>0 时优先用 total", () => {
    const model = makeModel(100, 100)
    const tokens = makeTokens(200, 9999, 9999)
    expect(isOverflow({ cfg: makeCfg(), tokens, model })).toBe(true)
  })
})
