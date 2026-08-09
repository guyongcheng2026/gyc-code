import { describe, expect, it } from "bun:test"
import { languageDirective } from "./request"

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