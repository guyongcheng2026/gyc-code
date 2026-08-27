import { describe, expect, test } from "bun:test"
import { createDeltaFlushController, DELTA_FLUSH_MS, nextFlushDelayMs } from "./delta-flush"

describe("nextFlushDelayMs", () => {
  test("涓流：距上次排空已满一个窗口，立即排空", () => {
    expect(nextFlushDelayMs(0, DELTA_FLUSH_MS, DELTA_FLUSH_MS)).toBe(0)
    expect(nextFlushDelayMs(0, 10_000, DELTA_FLUSH_MS)).toBe(0)
  })

  test("洪泛：窗口未满，按剩余时间合并", () => {
    expect(nextFlushDelayMs(0, 5, DELTA_FLUSH_MS)).toBe(DELTA_FLUSH_MS - 5)
  })

  test("时钟回拨不产生负延迟", () => {
    expect(nextFlushDelayMs(10_000, 0, DELTA_FLUSH_MS)).toBe(0)
  })
})

describe("createDeltaFlushController", () => {
  test("窗口内多次 schedule 合并为一次 flush", async () => {
    let flushes = 0
    const controller = createDeltaFlushController(() => flushes++, 5)
    controller.schedule()
    controller.schedule()
    controller.schedule()
    await Bun.sleep(20)
    expect(flushes).toBe(1)
    controller.dispose()
  })

  test("排空后再次 schedule 可再次触发", async () => {
    let flushes = 0
    const controller = createDeltaFlushController(() => flushes++, 5)
    controller.schedule()
    await Bun.sleep(15)
    controller.schedule()
    await Bun.sleep(15)
    expect(flushes).toBe(2)
    controller.dispose()
  })

  test("dispose 取消未决的 flush", async () => {
    let flushes = 0
    const controller = createDeltaFlushController(() => flushes++, 5)
    controller.schedule()
    controller.dispose()
    controller.dispose()
    await Bun.sleep(20)
    expect(flushes).toBe(0)
  })

  test("涓流节奏下逐次立即排空（延迟 0）", async () => {
    const flushTimes: number[] = []
    const controller = createDeltaFlushController(() => flushTimes.push(performance.now()), 5)
    // 首个 token：lastFlushAt=0，必然立即排空
    controller.schedule()
    await Bun.sleep(15)
    // 模拟涓流：间隔远大于窗口后再来 token
    await Bun.sleep(10)
    controller.schedule()
    await Bun.sleep(15)
    expect(flushTimes.length).toBe(2)
    controller.dispose()
  })
})
