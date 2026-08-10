import { describe, expect, it } from "bun:test"
import { escalateOutputMax, resolveOutputTokenMax } from "./output-cap"

describe("escalateOutputMax", () => {
  it("caps at the model output limit when escalate cap is higher", () => {
    const model = { limit: { output: 16_000 } }
    expect(escalateOutputMax(model as any, 64_000)).toBe(16_000)
  })
  it("defaults to 64k when no escalate cap configured", () => {
    const model = { limit: { output: 128_000 } }
    expect(escalateOutputMax(model as any)).toBe(64_000)
  })
  it("honors a configured escalate cap below the model limit", () => {
    const model = { limit: { output: 128_000 } }
    expect(escalateOutputMax(model as any, 100_000)).toBe(100_000)
  })
})

describe("resolveOutputTokenMax", () => {
  it("flag wins over config", () => {
    expect(resolveOutputTokenMax({ outputTokenMax: 64_000 }, { llm: { output_token_max: 32_000 } })).toBe(64_000)
  })
  it("falls back to config when flag is unset", () => {
    expect(resolveOutputTokenMax({}, { llm: { output_token_max: 40_000 } })).toBe(40_000)
  })
  it("returns undefined when neither flag nor config is set", () => {
    expect(resolveOutputTokenMax({}, {})).toBeUndefined()
  })
})