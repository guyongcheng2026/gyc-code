import { describe, expect, test } from "bun:test"
import {
  classifyDeltaArrival,
  classifyPendingDeltas,
  createCompletionWatermark,
  createDeltaFlushController,
  DELTA_FLUSH_MS,
  nextFlushDelayMs,
  pendingDeltaKey,
  type PendingDelta,
} from "./delta-flush"

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

describe("到达序水位线（消息完成后到达的残留 delta）", () => {
  test("无完成水位线时，delta 一律视为早于完成", () => {
    expect(classifyDeltaArrival(1, undefined)).toBe("before")
  })

  test("seq ≤ 完成水位线：早于完成事件到达，仅被攒批延迟，必须写入", () => {
    expect(classifyDeltaArrival(6, 7)).toBe("before")
    expect(classifyDeltaArrival(7, 7)).toBe("before")
  })

  test("seq > 完成水位线：晚于完成事件到达，必须丢弃", () => {
    expect(classifyDeltaArrival(8, 7)).toBe("after")
  })

  test("pendingDeltaKey：早/晚两个分桶落到不同 key，合并时不串味", () => {
    const before = pendingDeltaKey("m1", "p1", "text", "before")
    const after = pendingDeltaKey("m1", "p1", "text", "after")
    expect(before).not.toBe(after)
    expect(pendingDeltaKey("m1", "p1", "text", "before")).toBe(before)
  })

  test("classifyPendingDeltas：早于完成的写入，晚于完成的丢弃", () => {
    const deltas = [
      { messageID: "m1", seq: 5, text: "早" },
      { messageID: "m1", seq: 9, text: "晚" },
      { messageID: "m2", seq: 9, text: "他消息" },
    ]
    const completed = new Map([["m1", 7]])
    const { apply, drop } = classifyPendingDeltas(deltas, completed)
    expect(apply.map((d) => d.text)).toEqual(["早", "他消息"])
    expect(drop.map((d) => d.text)).toEqual(["晚"])
  })

  test("createCompletionWatermark：首次完成事件即终态锚点，后续 completed 不放宽水位线", () => {
    const wm = createCompletionWatermark()
    wm.mark("m1", 7)
    wm.mark("m1", 20)
    expect(wm.get("m1")).toBe(7)
    wm.mark("m2", 3)
    expect(wm.get("m2")).toBe(3)
    expect(wm.get("m3")).toBeUndefined()
    expect(wm.read().get("m1")).toBe(7)
  })

  // 复刻 sync.tsx 的攒批累积过程，验证两条业务约束同时成立。
  const accumulate = (wm: ReturnType<typeof createCompletionWatermark>) => {
    const pending = new Map<string, PendingDelta>()
    const add = (seq: number, messageID: string, text: string) => {
      const arrival = classifyDeltaArrival(seq, wm.get(messageID))
      const key = pendingDeltaKey(messageID, "p1", "text", arrival)
      const existing = pending.get(key)
      if (existing) existing.text += text
      else
        pending.set(key, {
          sessionID: "s1",
          messageID,
          partID: "p1",
          field: "text",
          text,
          seq,
        })
    }
    return { pending, add }
  }

  test("场景一：delta 先到、completed 后到，攒批窗口内 flush 仍写入（不能丢字）", () => {
    const wm = createCompletionWatermark()
    const { pending, add } = accumulate(wm)
    add(1, "m1", "前半")
    wm.mark("m1", 2)
    const { apply, drop } = classifyPendingDeltas(pending.values(), wm.read())
    expect(apply.map((d) => d.text)).toEqual(["前半"])
    expect(drop).toHaveLength(0)
  })

  test("场景二：completed 先到、残留 delta 后到，残留文本不污染已完成消息", () => {
    const wm = createCompletionWatermark()
    const { pending, add } = accumulate(wm)
    add(1, "m1", "前半")
    wm.mark("m1", 2)
    add(3, "m1", "后半")
    const { apply, drop } = classifyPendingDeltas(pending.values(), wm.read())
    expect(apply.map((d) => d.text)).toEqual(["前半"])
    expect(drop.map((d) => d.text)).toEqual(["后半"])
  })

  test("场景三：同 key 的连续 delta 仍合并为一条，早/晚分桶互不合并", () => {
    const wm = createCompletionWatermark()
    const { pending, add } = accumulate(wm)
    add(1, "m1", "A")
    add(2, "m1", "B")
    wm.mark("m1", 3)
    add(4, "m1", "C")
    expect(pending.size).toBe(2)
    const { apply, drop } = classifyPendingDeltas(pending.values(), wm.read())
    expect(apply.map((d) => d.text)).toEqual(["AB"])
    expect(drop.map((d) => d.text)).toEqual(["C"])
  })
})
