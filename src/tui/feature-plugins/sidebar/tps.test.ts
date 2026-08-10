import { describe, expect, it } from "bun:test"
import { streamingTPS, completedTPS, formatTPS } from "./tps"

describe("streamingTPS", () => {
  it("returns null when text is empty", () => {
    expect(streamingTPS("", 0, 1000)).toBeNull()
  })

  it("returns null when elapsed < 0.5s", () => {
    expect(streamingTPS("hello world this is some text for tokens", 0, 400)).toBeNull()
  })

  it("computes tokens/sec from estimated token count", () => {
    // "abcdefghij123456" (16 ASCII chars, no separator) -> 1 word token by tokenizer, elapsed 2s => 0.5 t/s
    const result = streamingTPS("abcdefghij123456", 0, 2000)
    expect(result).not.toBeNull()
    expect(result!).toBeCloseTo(0.5, 5)
  })

  it("handles JSON-shaped input (2 chars/token)", () => {
    // '{"key":"val"}' tokenizes to 9 tokens (braces/quotes/colon + word), 1s => 9 t/s
    const result = streamingTPS('{"key":"val"}', 0, 1000)
    expect(result).not.toBeNull()
    expect(result!).toBeCloseTo(9, 5)
  })
})

describe("completedTPS", () => {
  it("returns null when both output and reasoning are 0", () => {
    expect(completedTPS(0, 0, 0, 1000)).toBeNull()
  })

  it("returns null when elapsed < 0.001s", () => {
    expect(completedTPS(100, 0, 0, 0)).toBeNull()
  })

  it("computes tps from output + reasoning tokens over elapsed", () => {
    // 1000 output + 500 reasoning = 1500 tokens over 10s => 150 t/s
    expect(completedTPS(1000, 500, 0, 10000)).toBeCloseTo(150, 5)
  })

  it("works when only reasoning tokens", () => {
    expect(completedTPS(0, 500, 1000, 2000)).toBeCloseTo(500, 5)
  })
})

describe("formatTPS", () => {
  it("returns null for null input", () => {
    expect(formatTPS(null)).toBeNull()
  })

  it("formats <1 t/s", () => {
    expect(formatTPS(0.5)).toBe("<1 t/s")
  })

  it("formats whole number t/s", () => {
    expect(formatTPS(12.3)).toBe("12 t/s")
  })

  it("formats high tps", () => {
    expect(formatTPS(245.7)).toBe("246 t/s")
  })
})