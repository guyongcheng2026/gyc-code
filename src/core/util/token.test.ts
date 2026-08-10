import { describe, expect, test } from "bun:test"
import { estimate, estimateWithAPI } from "./token"
import { tokenize } from "./tokenizer"

test("estimate returns 0 for empty input", () => {
  expect(estimate("")).toBe(0)
})

test("estimate counts word-ish tokens for ASCII prose", () => {
  const text = "the quick brown fox"
  // tokenizer: 4 words + 3 whitespace runs = 7 tokens
  expect(estimate(text)).toBe(7)
})

test("estimate treats CJK as denser than ASCII of the SAME length", () => {
  const zh = "中".repeat(20) // 20 CJK chars → 20 tokens
  const en = "a".repeat(20) // 20 ASCII chars → 1 token
  expect(estimate(zh)).toBeGreaterThan(estimate(en))
})

test("estimate treats code symbols as denser than prose of the SAME length", () => {
  const code = "a{b}c[d]e(f)g<h>i{j}k[l]m(n)o{p}q[r]s{t}u"
  const prose = "b".repeat(code.length)
  expect(estimate(code)).toBeGreaterThan(estimate(prose))
})

test("estimate handles mixed content deterministically", () => {
  const a = estimate("some text 12345 !@#$% 中文混排")
  const b = estimate("some text 12345 !@#$% 中文混排")
  expect(a).toBe(b)
})

test("estimate matches tokenize length (parity)", () => {
  const samples = ["hello world", "中文测试", '{"a":1}', "a{b}c", "  spaced  out  "]
  for (const s of samples) {
    expect(estimate(s)).toBe(tokenize(s).length)
  }
})

describe("estimateWithAPI", () => {
  test("falls back to local estimate when the API call throws", async () => {
    const api = {
      countTokens: async () => {
        throw new Error("network down")
      },
    } as any
    const result = await estimateWithAPI("你好世界", { api, model: "anthropic/claude-haiku-4-5" })
    expect(result).toBe(4) // local tokenize count
  })

  test("returns the API count when it succeeds", async () => {
    const api = {
      countTokens: async () => 123,
    } as any
    const result = await estimateWithAPI("some text", { api, model: "anthropic/claude-haiku-4-5" })
    expect(result).toBe(123)
  })

  test("falls back to local estimate when the API returns an invalid count", async () => {
    for (const invalid of [-1, NaN]) {
      const api = {
        countTokens: async () => invalid,
      } as any
      const result = await estimateWithAPI("中文测试", { api, model: "anthropic/claude-haiku-4-5" })
      expect(result).toBe(4) // local tokenize count
    }
  })

  test("uses local estimate when no api/model provided", async () => {
    const result = await estimateWithAPI("你好世界", {})
    expect(result).toBe(4)
  })
})
