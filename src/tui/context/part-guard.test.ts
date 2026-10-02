import { describe, expect, test } from "bun:test"
import { isOrphanPartEvent } from "./part-guard"

describe("isOrphanPartEvent", () => {
  test("消息仍在 store 中：非孤儿，正常写入", () => {
    const messages = [{ id: "m1" }, { id: "m2" }]
    expect(isOrphanPartEvent(messages, "m2")).toBe(false)
  })

  test("消息已被淘汰（不在 store 中）：判定为孤儿", () => {
    const messages = [{ id: "m2" }]
    // m1 曾被 >100 淘汰并 delete 了 draft.part[m1]
    expect(isOrphanPartEvent(messages, "m1")).toBe(true)
  })

  test("会话从未水合（store 中无消息）：判定为孤儿", () => {
    // 订阅建立晚于部分事件到达时会出现，此刻不应凭事件新建 part 条目
    expect(isOrphanPartEvent(undefined, "m1")).toBe(true)
    expect(isOrphanPartEvent([], "m1")).toBe(true)
  })

  test("messageID 为空：判定为孤儿（防御异常事件）", () => {
    expect(isOrphanPartEvent([{ id: "m1" }], "")).toBe(true)
  })

  test("大量消息下仍能正确判定（线性扫描不漏判）", () => {
    const messages = Array.from({ length: 500 }, (_, i) => ({ id: `m${i}` }))
    expect(isOrphanPartEvent(messages, "m499")).toBe(false)
    expect(isOrphanPartEvent(messages, "m0")).toBe(false)
    // m500 超出窗口（已被 100 条上限淘汰）
    expect(isOrphanPartEvent(messages, "m500")).toBe(true)
  })
})
