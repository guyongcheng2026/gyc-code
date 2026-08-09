import { describe, expect, it } from "bun:test"
import { tokenize } from "./tokenizer"

describe("tokenize", () => {
  it("splits ASCII prose into word-ish tokens", () => {
    const tokens = tokenize("hello world this is a test")
    // 6 words + 5 whitespace tokens (design: whitespace run = 1 token) = 11
    expect(tokens.length).toBe(11)
    expect(tokens).toContain("hello")
  })

  it("counts each CJK char as one token", () => {
    const tokens = tokenize("你好世界")
    expect(tokens.length).toBe(4)
  })

  it("counts code symbols individually", () => {
    const tokens = tokenize("foo(bar);")
    // foo, (, bar, ), ;  → 5 (no space between)
    expect(tokens.length).toBe(5)
  })

  it("treats JSON punctuation densely", () => {
    const tokens = tokenize('{"a":1}')
    expect(tokens.length).toBeGreaterThanOrEqual(6)
  })

  it("returns empty array for empty input", () => {
    expect(tokenize("")).toEqual([])
  })

  it("collapses a whitespace run into one token", () => {
    expect(tokenize("a\n\n\n  b")).toEqual(["a", " ", "b"])
  })
})
