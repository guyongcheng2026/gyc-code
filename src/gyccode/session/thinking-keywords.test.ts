import { describe, expect, it } from "bun:test"
import { thinkingKeywordTarget, resolveThinkingVariant } from "./thinking-keywords"

describe("thinkingKeywordTarget", () => {
  it("returns undefined for empty text", () => {
    expect(thinkingKeywordTarget("")).toBeUndefined()
    expect(thinkingKeywordTarget(undefined as unknown as string)).toBeUndefined()
  })

  it("targets high for plain 'think'", () => {
    expect(thinkingKeywordTarget("think through this")).toBe("high")
    expect(thinkingKeywordTarget("Please think about it")).toBe("high")
  })

  it("targets xhigh for 'think harder'/'think deeply'", () => {
    expect(thinkingKeywordTarget("think harder on this")).toBe("xhigh")
    expect(thinkingKeywordTarget("think deeply about the design")).toBe("xhigh")
  })

  it("targets max for 'ultrathink'", () => {
    expect(thinkingKeywordTarget("ultrathink this problem")).toBe("max")
  })

  it("returns undefined for text without keywords", () => {
    expect(thinkingKeywordTarget("refactor the module")).toBeUndefined()
  })

  it("prefers the strongest keyword present", () => {
    expect(thinkingKeywordTarget("think and ultrathink")).toBe("max")
  })
})

describe("resolveThinkingVariant", () => {
  it("returns undefined when no target or no variants", () => {
    expect(resolveThinkingVariant(undefined, undefined)).toBeUndefined()
    expect(resolveThinkingVariant("high", undefined)).toBeUndefined()
    expect(resolveThinkingVariant("high", {})).toBeUndefined()
  })

  it("returns the exact available target", () => {
    expect(
      resolveThinkingVariant("high", { low: {}, medium: {}, high: {}, max: {} }),
    ).toBe("high")
  })

  it("upgrades to the next available stronger tier", () => {
    expect(resolveThinkingVariant("xhigh", { low: {}, medium: {}, high: {}, max: {} })).toBe("max")
  })

  it("falls back to the strongest available tier when target absent", () => {
    expect(resolveThinkingVariant("high", { low: {}, medium: {} })).toBe("medium")
    expect(resolveThinkingVariant("max", { low: {}, medium: {} })).toBe("medium")
  })

  it("returns the target when it is a non-standard variant", () => {
    expect(resolveThinkingVariant("high", { medium: {}, high: {}, custom: {} })).toBe("high")
  })
})