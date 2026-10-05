import { describe, expect, it } from "bun:test"
import { createHandleEstimateCache, estimateContentHandles } from "./handle-budget"

describe("createHandleEstimateCache", () => {
  it("returns the same value as the uncached estimate on first call", () => {
    const cache = createHandleEstimateCache()
    const text = "hello\nworld\n\nsecond block"
    expect(cache(text, 80)).toBe(estimateContentHandles(text, 80))
  })

  it("reuses the previous result when the text grows by less than the threshold", () => {
    let calls = 0
    const cache = createHandleEstimateCache({
      estimate: (text, cols) => {
        calls++
        return estimateContentHandles(text, cols)
      },
    })
    const base = "x".repeat(1000)
    const first = cache(base, 80)
    const second = cache(base + "y".repeat(100), 80)
    expect(calls).toBe(1)
    expect(second).toBe(first)
  })

  it("recomputes once the growth reaches the threshold", () => {
    let calls = 0
    const cache = createHandleEstimateCache({
      estimate: (text, cols) => {
        calls++
        return estimateContentHandles(text, cols)
      },
    })
    const base = "x".repeat(1000)
    cache(base, 80)
    cache(base + "y".repeat(1024), 80)
    expect(calls).toBe(2)
  })

  it("recomputes when the column width changes", () => {
    let calls = 0
    const cache = createHandleEstimateCache({
      estimate: (text, cols) => {
        calls++
        return estimateContentHandles(text, cols)
      },
    })
    const text = "x".repeat(1000)
    cache(text, 80)
    cache(text, 120)
    expect(calls).toBe(2)
  })

  it("recomputes when the text shrinks below the previous length", () => {
    let calls = 0
    const cache = createHandleEstimateCache({
      estimate: (text, cols) => {
        calls++
        return estimateContentHandles(text, cols)
      },
    })
    cache("x".repeat(5000), 80)
    cache("x".repeat(10), 80)
    expect(calls).toBe(2)
  })

  it("falls back to recomputing for non-finite column widths", () => {
    let calls = 0
    const cache = createHandleEstimateCache({
      estimate: (text, cols) => {
        calls++
        return estimateContentHandles(text, cols)
      },
    })
    cache("x".repeat(1000), 80)
    cache("x".repeat(1000), Number.NaN)
    expect(calls).toBe(2)
  })

  it("keeps serving the cached value for repeated identical input", () => {
    let calls = 0
    const cache = createHandleEstimateCache({
      estimate: (text, cols) => {
        calls++
        return estimateContentHandles(text, cols)
      },
    })
    const text = "x".repeat(1000)
    for (let i = 0; i < 50; i++) cache(text, 80)
    expect(calls).toBe(1)
  })
})