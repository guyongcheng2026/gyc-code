import { expect, test } from "bun:test"
import { estimate } from "./token"

test("estimate returns 0 for empty input", () => {
  expect(estimate("")).toBe(0)
})

test("estimate uses 4 chars/token for plain ASCII prose", () => {
  const text = "the quick brown fox jumps over the lazy dog"
  expect(estimate(text)).toBe(Math.round(text.length / 4))
})

test("estimate uses 2 chars/token for JSON", () => {
  const json = '{"a": 1, "b": 2, "c": 3}'
  expect(estimate(json)).toBe(Math.round(json.length / 2))
})

test("estimate treats CJK as denser than ASCII of the SAME length", () => {
  const zh = "中".repeat(20) // 20 CJK chars
  const en = "a".repeat(20) // 20 ASCII chars
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
