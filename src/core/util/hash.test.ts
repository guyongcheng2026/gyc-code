import { describe, expect, it } from "bun:test"
import { hashString } from "./hash"

describe("hashString", () => {
  it("is deterministic", () => {
    expect(hashString("abc")).toBe(hashString("abc"))
  })
  it("differs for different inputs", () => {
    expect(hashString("abc")).not.toBe(hashString("abd"))
  })
  it("is 16 hex chars", () => {
    expect(hashString("x")).toMatch(/^[0-9a-f]{16}$/)
  })
})
