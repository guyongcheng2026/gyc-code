import { describe, expect, it } from "bun:test"
import { Hash } from "./hash"

describe("Hash.sha256", () => {
  it("is deterministic", () => {
    expect(Hash.sha256("abc")).toBe(Hash.sha256("abc"))
  })
  it("differs for different inputs", () => {
    expect(Hash.sha256("abc")).not.toBe(Hash.sha256("abd"))
  })
  it("is 64 hex chars", () => {
    expect(Hash.sha256("x")).toMatch(/^[0-9a-f]{64}$/)
  })
})

describe("Hash.fast", () => {
  it("is deterministic", () => {
    expect(Hash.fast("abc")).toBe(Hash.fast("abc"))
  })
})
