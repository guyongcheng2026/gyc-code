import { describe, expect, it } from "bun:test"
import { renderScaleFor } from "./render-scale"

// 规模档位量化的回归：下游帧率 effect 必须只在跨档时重跑。
//
// 立项（2026-10-20 抖动排查）：renderScale 曾返回 { scale } 新对象——Solid 的
// memo 用 === 比较依赖，新对象等于每次都变更，下游 effect 随每条消息重跑，
// 量化等于没做。改为返回数值后，档位不变即不触发下游。

const FACTOR = 3
const THRESHOLD = 200

describe("renderScaleFor", () => {
  it("不足一个阈值时为 0（不降档）", () => {
    expect(renderScaleFor(0, FACTOR, THRESHOLD)).toBe(0)
    expect(renderScaleFor(1, FACTOR, THRESHOLD)).toBe(0)
    expect(renderScaleFor(66, FACTOR, THRESHOLD)).toBe(0)
  })

  it("跨过阈值后量化为阈值的整数倍", () => {
    expect(renderScaleFor(67, FACTOR, THRESHOLD)).toBe(200)
    expect(renderScaleFor(133, FACTOR, THRESHOLD)).toBe(200)
    expect(renderScaleFor(134, FACTOR, THRESHOLD)).toBe(400)
  })

  it("同一档区间内取值恒定（这是量化存在的意义）", () => {
    const values = new Set<number>()
    for (let n = 1; n <= 1000; n++) values.add(renderScaleFor(n, FACTOR, THRESHOLD))
    // 1000 条消息（×3 节点）= 3000，跨 15 个档位
    // 1000 条消息（×3 节点）= 3000，取值覆盖 0..3000 共 16 个档位
    expect(values.size).toBe(16)
  })

  it("取档结果与未量化的 floor(scale/threshold) 一致（量化不改变降档档位）", () => {
    for (let n = 1; n <= 2000; n += 7) {
      const raw = Math.floor((n * FACTOR) / THRESHOLD)
      const quantized = renderScaleFor(n, FACTOR, THRESHOLD)
      expect(Math.floor(quantized / THRESHOLD)).toBe(raw)
    }
  })

  it("非法输入归零（不产生 NaN 污染下游）", () => {
    expect(renderScaleFor(Number.NaN, FACTOR, THRESHOLD)).toBe(0)
    expect(renderScaleFor(-1, FACTOR, THRESHOLD)).toBe(0)
    expect(renderScaleFor(10, 0, THRESHOLD)).toBe(0)
    expect(renderScaleFor(10, FACTOR, 0)).toBe(0)
  })
})
