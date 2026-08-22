import { expect, test } from "bun:test"
import { summarizeText, shouldSummarize, type Summarizer } from "./summarize"

test("shouldSummarize is false for small content", () => {
  expect(shouldSummarize("small text".repeat(100), 100_000)).toBe(false)
})

test("shouldSummarize is true for large content above the threshold", () => {
  const big = "x".repeat(150_000)
  expect(shouldSummarize(big, 100_000)).toBe(true)
})

test("summarizeText calls the summarizer with a bounded context", async () => {
  const big = "content ".repeat(30_000) // ~240k chars
  let saw = ""
  const summarizer: Summarizer = (text) => {
    saw = text
    return Promise.resolve("summary")
  }
  const result = await summarizeText(big, summarizer, 100_000)
  expect(result).toBe("summary")
  // The summarizer must not receive the whole 240k input; only a bounded slice.
  expect(saw.length).toBeLessThan(120_000)
  expect(saw.length).toBeGreaterThan(50_000)
})

test("summarizeText returns the raw text when summarizer fails", async () => {
  const text = "y".repeat(120_000)
  const summarizer: Summarizer = () => Promise.reject(new Error("boom"))
  const result = await summarizeText(text, summarizer, 100_000)
  expect(result).toBe(text)
})
