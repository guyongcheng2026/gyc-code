import { describe, test, expect } from "bun:test"
import type { Provider } from "./provider"

function modelWith(over: Partial<Provider.Model["capabilities"]> & { id?: string; providerID?: string }): any {
  return {
    id: over.id ?? "claude-sonnet-4-6",
    providerID: over.providerID ?? "anthropic",
    api: { id: over.id ?? "claude-sonnet-4-6", npm: "@ai-sdk/anthropic", transport: "ai-sdk" },
    limit: { context: 200_000, output: 32_000 },
    capabilities: {
      reasoning: over.reasoning ?? true,
      input: { text: true, image: false, audio: false, video: false, pdf: false },
      output: { text: true, audio: false, image: false, video: false },
      temperature: true,
      toolcall: true,
      attachment: false,
    },
  }
}

describe("shouldEnableThinkingByDefault", () => {
  const { shouldEnableThinkingByDefault } = require("./transform") as typeof import("./transform")

  test("returns true for a reasoning-capable model with no explicit config", () => {
    expect(shouldEnableThinkingByDefault(modelWith({}), {})).toBe(true)
  })

  test("returns true even when model declares no explicit agent variant", () => {
    expect(shouldEnableThinkingByDefault(modelWith({ id: "claude-sonnet-4-6" }), {})).toBe(true)
  })

  test("returns false when config explicitly disables thinking", () => {
    expect(shouldEnableThinkingByDefault(modelWith({}), { llm: { thinking: { enabled: false } } })).toBe(false)
  })

  test("returns false for a model without reasoning capability", () => {
    expect(shouldEnableThinkingByDefault(modelWith({ reasoning: false }), {})).toBe(false)
  })

  test("returns false when user-level flag disables thinking", () => {
    expect(shouldEnableThinkingByDefault(modelWith({}), { user: { disableThinkingByDefault: true } })).toBe(false)
  })
})
