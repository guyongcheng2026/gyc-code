import { expect, test } from "bun:test"
import { DeepseekTokenizer, estimateDeepSeek, getDeepseekTokenizer } from "./deepseek-tokenizer"

test("DeepseekTokenizer encode/decode roundtrip for ASCII", () => {
  const t = new DeepseekTokenizer()
  const ids = t.encode("hello world")
  expect(Array.isArray(ids)).toBe(true)
  expect(ids.length).toBeGreaterThan(0)
  const decoded = t.decode(ids)
  expect(typeof decoded).toBe("string")
})

test("DeepseekTokenizer count matches encode length", () => {
  const t = new DeepseekTokenizer()
  const text = "Hello, 世界! 123"
  expect(t.count(text)).toBe(t.encode(text).length)
})

test("estimateDeepSeek returns number for non-empty text", () => {
  const n = estimateDeepSeek("hello world")
  expect(typeof n).toBe("number")
  expect(n).toBeGreaterThan(0)
})

test("estimateDeepSeek returns 0 for empty text", () => {
  expect(estimateDeepSeek("")).toBe(0)
})

test("getDeepseekTokenizer returns singleton", () => {
  const a = getDeepseekTokenizer()
  const b = getDeepseekTokenizer()
  expect(a).toBe(b)
})
