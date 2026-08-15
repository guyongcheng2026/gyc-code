import { describe, expect, it, vi } from "vitest"
import { renderHook, waitFor } from "@testing-library/react"
import { useChatSession } from "./useChatSession"

const messages = vi.fn(() => Promise.resolve({ data: [{ id: "m1", role: "assistant" }] }))
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
  })
})
