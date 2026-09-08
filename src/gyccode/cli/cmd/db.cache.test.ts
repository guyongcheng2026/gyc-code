import { describe, expect, test } from "bun:test"
import { classifyMiss, promptCacheStats, CACHE_WINDOW_MS, type PerMessageRow } from "./db"

function row(tokens: unknown, time: number | string = 0): { data: string; time_created: number | string } {
  return { data: JSON.stringify({ tokens }), time_created: time }
}

describe("promptCacheStats（gyc db cache 命中率口径）", () => {
  test("分母还原总输入：net input + cache.read + cache.write，不含 output/reasoning", () => {
    // AI SDK v6 归一化：inputTokens=10000（含缓存），output=500 → total=10500。
    // 落库 tokens：input=净输入 1000，cache.read=8000，cache.write=1000，total=10500。
    // 命中率分子 8000，分母应为 10000（真实输入规模），而非 10500（含 output 被低估）。
    const stats = promptCacheStats([
      row({ total: 10500, input: 1000, output: 500, reasoning: 0, cache: { read: 8000, write: 1000 } }),
    ])
    expect(stats.withTokens).toBe(1)
    expect(stats.totalInput).toBe(10000)
    expect(stats.cacheRead).toBe(8000)
  })

  test("全缓存命中：cache.read == 总输入时统计口径为 100%", () => {
    const stats = promptCacheStats([
      row({ total: 10500, input: 0, output: 500, cache: { read: 10000, write: 0 } }),
    ])
    expect(stats.totalInput).toBe(10000)
    expect(stats.cacheRead).toBe(10000)
    // 旧口径（分母取 total=10500）只会得到 95.2%，新口径正确反映 100% 命中
    expect(stats.cacheRead / stats.totalInput).toBe(1)
  })

  test("DeepSeek 型补读：cache.read 单列、净输入含于 input 时口径自洽", () => {
    const stats = promptCacheStats([
      row({ total: 9500, input: 500, output: 500, cache: { read: 9000, write: 0 } }),
    ])
    expect(stats.totalInput).toBe(9500)
    expect(stats.cacheRead).toBe(9000)
  })

  test("跳过无 tokens 与畸形行", () => {
    const stats = promptCacheStats([
      { data: JSON.stringify({ tokens: undefined }), time_created: 0 },
      { data: "{ bad json", time_created: 0 },
      { data: JSON.stringify({ tokens: { input: 0, total: 0, cache: { read: 0, write: 0 } } }), time_created: 0 },
    ])
    expect(stats.withTokens).toBe(0)
    expect(stats.totalInput).toBe(0)
  })

  test("多行累计与逐条记录（保持行序）", () => {
    const stats = promptCacheStats([
      row({ input: 100, output: 20, total: 120, cache: { read: 90, write: 0 } }, 1),
      row({ input: 200, output: 30, total: 230, cache: { read: 180, write: 0 } }, 2),
    ])
    expect(stats.withTokens).toBe(2)
    // 分母各为 190 / 380，命中 90 / 180
    expect(stats.totalInput).toBe(190 + 380)
    expect(stats.cacheRead).toBe(90 + 180)
    expect(stats.perMessage[0]).toEqual({ time: 1, total: 190, cached: 90 })
    expect(stats.perMessage[1]).toEqual({ time: 2, total: 380, cached: 180 })
  })

  test("负值钳制与非数字容错", () => {
    const stats = promptCacheStats([
      row({ input: -5, output: 1, total: 100, cache: { read: "10", write: -3 } }),
    ])
    // input 为数字(-5) → netInput=0（Math.max）；read 非数字→0；write 负数→0
    expect(stats.totalInput).toBe(0)
    expect(stats.withTokens).toBe(0)
  })
})

describe("classifyMiss（区分缓存窗口过期 vs 前缀漂移）", () => {
  const high = (time: number): PerMessageRow => ({ time, total: 1000, cached: 990 })
  const low = (time: number): PerMessageRow => ({ time, total: 1000, cached: 0 })

  test("与上一轮间隔超过缓存窗口的低命中行 → window-expiry（物理 miss，非前缀漂移）", () => {
    expect(classifyMiss(high(0), low(CACHE_WINDOW_MS + 1000))).toBe("window-expiry")
  })

  test("窗口内却近乎全 miss → drift（前缀确实与上轮不同）", () => {
    expect(classifyMiss(high(0), low(10_000))).toBe("drift")
  })

  test("高命中行不标注", () => {
    expect(classifyMiss(high(0), high(60_000))).toBeNull()
  })

  test("无上一轮（报告窗口首行）不误标", () => {
    expect(classifyMiss(undefined, low(0))).toBeNull()
  })

  test("上一轮本身低命中时不标注（持续低不是突变）", () => {
    expect(classifyMiss(low(0), low(60_000))).toBeNull()
  })

  test("边界：间隔恰好等于窗口阈值视为 drift（窗口内）", () => {
    expect(classifyMiss(high(0), low(CACHE_WINDOW_MS))).toBe("drift")
  })
})
