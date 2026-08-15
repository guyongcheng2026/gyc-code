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

  it("marks session idle", () => {
    const s = chatReducer(initialChatState(), { type: "session.idle", properties: { sessionID: "s1" } })
    expect(s.idle).toBe(true)
  })
})
