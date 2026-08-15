import { describe, expect, it, vi } from "vitest"
import { renderHook, waitFor } from "@testing-library/react"
import { useSessions } from "./useSessions"

const list = vi.fn(() => Promise.resolve({ data: [{ id: "s1" }] }))
vi.mock("@gyccode/protocol/v1", () => ({
  createGyccodeClient: () => ({ session: { list } }),
}))

describe("useSessions", () => {
  it("loads sessions on mount", async () => {
    const { result } = renderHook(() => useSessions())
    await waitFor(() => expect(result.current.sessions).toHaveLength(1))
    expect(result.current.sessions[0].id).toBe("s1")
  })
})
