import { describe, expect, it, vi } from "vitest"
import { render, screen } from "@testing-library/react"
import { App } from "./App"

vi.mock("@gyccode/protocol/v1", () => ({
  createGyccodeClient: () => ({
    session: {
      list: () => Promise.resolve({ data: [{ id: "sess-1" }, { id: "sess-2" }] }),
    },
  }),
}))

describe("App", () => {
  it("fetches and lists sessions", async () => {
    render(<App />)
    expect(await screen.findByText("sess-1")).toBeTruthy()
    expect(screen.getByText("sess-2")).toBeTruthy()
  })
})
