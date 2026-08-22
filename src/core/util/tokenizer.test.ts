import { describe, expect, it } from "bun:test"
import { count, tokenize } from "./tokenizer"

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

describe("count", () => {
  it("returns zero for empty input", () => {
    expect(count("")).toBe(0)
  })

  it("matches tokenize().length for every tested input", () => {
    const inputs = [
      "hello world this is a test",
      "你好世界",
      "foo(bar);",
      '{"a":1}',
      "a\n\n\n  b",
      "mixed 中文 and English 123 !@#",
      "",
    ]
    for (const input of inputs) {
      expect(count(input)).toBe(tokenize(input).length)
    }
  })
})
