import { describe, expect, it, vi } from "vitest"
import { render, screen } from "@testing-library/react"
import { App } from "./App"

vi.mock("@gyccode/protocol/v1", () => ({
  createGyccodeClient: () => ({
    session: {
      list: () => Promise.resolve({ data: [{ id: "sess-1" }, { id: "sess-2" }] }),
      create: () => Promise.resolve({ data: { id: "sess-new" } }),
      messages: () => Promise.resolve({ data: [] }),
      promptAsync: () => Promise.resolve({}),
      diff: () => Promise.resolve({ data: [] }),
      postSessionIdPermissionsPermissionId: () => Promise.resolve({}),
    },
    file: {
      list: () => Promise.resolve({ data: [] }),
      read: () => Promise.resolve({ data: { type: "text", content: "" } }),
      status: () => Promise.resolve({ data: [] }),
    },
    pty: {
      create: () => Promise.resolve({ data: { id: "pty-1" } }),
      update: () => Promise.resolve({}),
      remove: () => Promise.resolve({}),
    },
    global: { event: () => Promise.resolve({}) },
  }),
}))

describe("App", () => {
  it("fetches and lists sessions", async () => {
    render(<App />)
    expect(await screen.findByText("sess-1")).toBeTruthy()
    expect(screen.getByText("sess-2")).toBeTruthy()
  })
})
