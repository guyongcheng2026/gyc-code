import { describe, expect, it, vi } from "vitest"
import { renderHook, waitFor } from "@testing-library/react"
import { useChatSession } from "./useChatSession"

const messages = vi.fn(() =>
  Promise.resolve({
    data: [{ info: { id: "m1", role: "assistant", sessionID: "s1" }, parts: [{ id: "p1", type: "text", text: "hi" }] }],
  }),
)
const list = vi.fn(() => Promise.resolve({ data: [{ id: "s1" }] }))
vi.mock("@gyccode/protocol/v1", () => ({
  createGyccodeClient: () => ({
    session: { messages, list },
    global: { event: () => Promise.resolve({}) },
  }),
}))

describe("useChatSession", () => {
  it("loads messages for selected session", async () => {
    const { result } = renderHook(() => useChatSession("s1"))
    await waitFor(() => expect(result.current.messages).toHaveLength(1))
    expect(messages).toHaveBeenCalledWith({ path: { id: "s1" } })
    expect(result.current.messages[0].parts[0].text).toBe("hi")
  })
})
