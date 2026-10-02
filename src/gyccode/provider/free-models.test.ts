import { describe, expect, test } from "bun:test"
import { FREE_MODELS, isFreeModel, pickDefaultFreeModel } from "./free-models"

describe("免费模型回退", () => {
  test("无配置模型时，从可用模型里挑一个免费的", () => {
    const models = {
      "vendor-a/paid-model": { cost: { input: 3, output: 15 } },
      "vendor-b/free-model": { cost: { input: 0, output: 0 } },
    }
    expect(pickDefaultFreeModel(models)).toBe("vendor-b/free-model")
  })

  test("只有付费模型时返回 undefined，不硬凑", () => {
    const models = {
      "vendor-a/paid-model": { cost: { input: 3, output: 15 } },
    }
    expect(pickDefaultFreeModel(models)).toBeUndefined()
  })

  test("空模型表返回 undefined", () => {
    expect(pickDefaultFreeModel({})).toBeUndefined()
  })

  test("多个免费模型时，优先选清单里排在前面的", () => {
    const listed = FREE_MODELS[0]!
    const models = {
      // 对象遍历顺序把非清单模型放在前面，清单模型放最后
      "z/unlisted-free": { cost: { input: 0, output: 0 } },
      [listed]: { cost: { input: 0, output: 0 } },
    }
    // 清单内的模型必须胜出，证明排序依据是清单而非对象键序
    expect(pickDefaultFreeModel(models)).toBe(listed)
  })

  test("清单内模型若实际收费，则不选它", () => {
    const listed = FREE_MODELS[0]!
    const models = {
      "z/unlisted-free": { cost: { input: 0, output: 0 } },
      [listed]: { cost: { input: 5, output: 20 } },
    }
    // 清单只是优先级提示，最终仍以实际定价为准
    expect(pickDefaultFreeModel(models)).toBe("z/unlisted-free")
  })

  test("所有免费模型都不在清单里时，仍能兜底选第一个", () => {
    const models = {
      "unknown/free-x": { cost: { input: 0, output: 0 } },
      "unknown/free-y": { cost: { input: 0, output: 0 } },
    }
    expect(pickDefaultFreeModel(models)).toBe("unknown/free-x")
  })
})

describe("免费模型识别", () => {
  test("清单里的模型被识别为免费", () => {
    expect(FREE_MODELS.length).toBeGreaterThan(0)
    expect(isFreeModel(FREE_MODELS[0]!)).toBe(true)
  })

  test("清单外的模型不是免费", () => {
    expect(isFreeModel("vendor/paid")).toBe(false)
  })

  test("清单不含空串或重复项", () => {
    expect(FREE_MODELS.every((m) => m.trim().length > 0)).toBe(true)
    expect(new Set(FREE_MODELS).size).toBe(FREE_MODELS.length)
  })
})