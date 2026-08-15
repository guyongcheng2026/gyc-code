import { describe, expect, it, vi } from "vitest"
import { fireEvent, render, screen } from "@testing-library/react"
import { ChatPanel } from "./ChatPanel"

const promptAsync = vi.fn(() => Promise.resolve({}))
vi.mock("@gyccode/protocol/v1", () => ({
  createGyccodeClient: () => ({
    session: { promptAsync, postSessionIdPermissionsPermissionId: () => Promise.resolve({}) },
    global: { event: () => Promise.resolve({}) },
  }),
}))
vi.mock("../client/useChatSession", () => ({
  useChatSession: () => ({ messages: [], idle: true, busy: false }),
}))

describe("ChatPanel", () => {
  it("sends prompt on submit", () => {
    render(<ChatPanel sessionID="s1" />)
    const input = screen.getByPlaceholderText("向 gyc 描述你要完成的任务…")
    fireEvent.change(input, { target: { value: "你好" } })
    fireEvent.keyDown(input, { key: "Enter" })
    expect(promptAsync).toHaveBeenCalledWith({
      path: { id: "s1" },
      body: { parts: [{ type: "text", text: "你好" }] },
    })
  })
})
