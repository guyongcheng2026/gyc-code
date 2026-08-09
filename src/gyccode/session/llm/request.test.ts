import { describe, expect, it } from "bun:test"
import { languageDirective, resolveMaxOutputTokens } from "./request"

describe("languageDirective", () => {
  it("defaults to Simplified Chinese when no language is configured", () => {
    const prev = process.env.GYCCODE_LANGUAGE
    delete process.env.GYCCODE_LANGUAGE
    try {
      const directive = languageDirective(undefined)
      expect(directive).toContain("Simplified Chinese")
      expect(directive).toContain("zh-CN")
    } finally {
      if (prev) process.env.GYCCODE_LANGUAGE = prev
    }
  })

  it("uses zh-CN / zh / zh-Hans variants as Simplified Chinese", () => {
    for (const lang of ["zh-CN", "zh", "zh-Hans", "zh-sg"]) {
      const directive = languageDirective(lang)
      expect(directive).toContain("Simplified Chinese")
      expect(directive).toContain("zh-CN")
    }
  })

  it("uses English for en variants", () => {
    for (const lang of ["en", "en-US", "en-GB"]) {
      expect(languageDirective(lang)).toBe("Always respond in English.")
    }
  })

  it("falls back to a generic directive for other languages", () => {
    expect(languageDirective("fr")).toBe("Always respond in fr.")
  })

  it("honors the GYCCODE_LANGUAGE environment override", () => {
    const prev = process.env.GYCCODE_LANGUAGE
    process.env.GYCCODE_LANGUAGE = "en"
    try {
      expect(languageDirective(undefined)).toBe("Always respond in English.")
    } finally {
      if (prev) process.env.GYCCODE_LANGUAGE = prev
      else delete process.env.GYCCODE_LANGUAGE
    }
  })
})

describe("resolveMaxOutputTokens", () => {
  const model = { limit: { output: 128_000 } } as any

  it("uses the override when provided (64k escalate)", () => {
    expect(resolveMaxOutputTokens(model, undefined, 64_000)).toBe(64_000)
  })

  it("falls back to the computed cap when no override is given", () => {
    // No override -> min(model.output, default 32k) = 32_000
    expect(resolveMaxOutputTokens(model, undefined, undefined)).toBe(32_000)
  })

  it("honors a configured outputTokenMax when no override is given", () => {
    expect(resolveMaxOutputTokens(model, 16_000, undefined)).toBe(16_000)
  })
})
