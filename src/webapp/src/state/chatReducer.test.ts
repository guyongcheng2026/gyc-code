import { describe, expect, it } from "vitest"
import { chatReducer, initialChatState } from "./chatReducer"

describe("chatReducer", () => {
  it("upserts assistant message on message.updated", () => {
    const s = chatReducer(initialChatState(), {
      type: "message.updated",
      properties: { info: { id: "m1", role: "assistant" } } as never,
    })
    expect(s.messages.some((m) => m.id === "m1")).toBe(true)
  })

  it("appends streamed part text on message.part.updated", () => {
    let s = chatReducer(initialChatState(), {
      type: "message.updated",
      properties: { info: { id: "m1", role: "assistant" } } as never,
    })
    s = chatReducer(s, {
      type: "message.part.updated",
      properties: { part: { id: "p1", type: "text", messageID: "m1", text: "你好" }, delta: "，世界" },
    })
    expect(s.messages[0].parts[0].text).toBe("你好，世界")
  })

  it("marks session idle", () => {
    const s = chatReducer(initialChatState(), { type: "session.idle", properties: { sessionID: "s1" } })
    expect(s.idle).toBe(true)
  })

  it("超长流式文本在状态层封顶并保留尾部", () => {
    // delta 是累加的，而状态层此前没有任何上界；渲染层只在 ToolBlocks 里按行数
    // 截断，文本 part 的整段内容会一直堆在内存里。封顶后必须保留尾部 ——
    // 用户要看的是最新输出，砍掉的应该是开头。
    let s = chatReducer(initialChatState(), {
      type: "message.updated",
      properties: { info: { id: "m1", role: "assistant" } } as never,
    })
    const chunk = (i: number) => `#${i}`.padEnd(50_000, "x")
    for (let i = 0; i < 10; i++) {
      s = chatReducer(s, {
        type: "message.part.updated",
        properties: { part: { id: "p1", type: "text", messageID: "m1" }, delta: chunk(i) },
      })
    }

    const text = s.messages[0].parts[0].text ?? ""
    expect(text.length).toBeLessThanOrEqual(200_000)
    expect(text.includes("#9")).toBe(true)
    expect(text.includes("#0")).toBe(false)
  })
})
