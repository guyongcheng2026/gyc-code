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
})
