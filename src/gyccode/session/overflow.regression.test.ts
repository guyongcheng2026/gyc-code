import { describe, expect, it } from "bun:test"
import { isOverflow } from "./overflow"

const makeModel = (context = 50000, inputLimit?: number): any => ({
  id: "test-model",
  providerID: "test-provider",
  limit: { context, input: inputLimit, output: 4096 },
  route: { defaults: { limits: { context, input: inputLimit, output: 4096 } } },
})

const makeCfg = (): any => ({ compaction: {} })

describe("session/overflow (P1 回归)", () => {
  it("P1 回归: total=0 不应误判为 overflow", () => {
    // 核心 bug: 修复前 total || ... 会把 0 当作 falsy
    // 导致: 0 || (input + output + ...) = input + output + ...
    // 修复后: (0 ?? 0) + input + output = 正确累加
    const model = makeModel(50000, 50000)
    const tokens = { total: 0, input: 5000, output: 5000, cache: { read: 0, write: 0 } }
    // total=0, 子字段和=10000, usable ≈ 50000 - 4096 ≈ 45904
    // 0 + 10000 = 10000 < 45904, 不溢出
    expect(isOverflow({ cfg: makeCfg(), tokens, model })).toBe(false)
  })

  it("total=0 且子字段和超过 context 时正确判定 overflow", () => {
    const model = makeModel(10000, 10000)
    const tokens = { total: 0, input: 6000, output: 6000, cache: { read: 0, write: 0 } }
    // 子字段和=12000 > context=10000, 应判定为 overflow
    expect(isOverflow({ cfg: makeCfg(), tokens, model })).toBe(true)
  })

  it("auto=false 时直接返回 false", () => {
    const model = makeModel(100, 100)
    const tokens = { total: 999, input: 999, output: 0, cache: { read: 0, write: 0 } }
    expect(isOverflow({ cfg: { compaction: { auto: false } }, tokens, model })).toBe(false)
  })

  it("context=0 时不判定 overflow", () => {
    const model = makeModel(0)
    const tokens = { total: 9999, input: 0, output: 0, cache: { read: 0, write: 0 } }
    expect(isOverflow({ cfg: makeCfg(), tokens, model })).toBe(false)
  })

  it("total>0 时优先用 total", () => {
    const model = makeModel(100, 100)
    const tokens = { total: 200, input: 9999, output: 9999, cache: { read: 9999, write: 9999 } }
    expect(isOverflow({ cfg: makeCfg(), tokens, model })).toBe(true)
  })
})
