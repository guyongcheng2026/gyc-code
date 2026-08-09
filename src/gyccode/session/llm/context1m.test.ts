import { describe, expect, it } from "bun:test"
import { CONTEXT_1M_BETA_HEADER, context1MHeader } from "./context-1m"

const M = 1_000_000

function modelWith(partial: Record<string, any>) {
  return {
    providerID: "anthropic",
    api: { id: "claude-sonnet-4-6", npm: "@ai-sdk/anthropic" },
    limit: { context: M, input: M, output: 128_000 },
    ...partial,
  } as any
}

describe("context1MHeader", () => {
  it("injects the 1M beta header for a 1M-context anthropic model", () => {
    const header = context1MHeader(modelWith({}))
    expect(header).toBe(CONTEXT_1M_BETA_HEADER)
  })

  it("returns undefined for a default 200K context model", () => {
    const header = context1MHeader(
      modelWith({ limit: { context: 200_000, input: 200_000, output: 64_000 } }),
    )
    expect(header).toBeUndefined()
  })

  it("merges with existing anthropic-beta betas separated by comma", () => {
    const header = context1MHeader(modelWith({}), "interleaved-thinking-2025-05-14")
    expect(header).toBe(`interleaved-thinking-2025-05-14,${CONTEXT_1M_BETA_HEADER}`)
  })

  it("does not duplicate the 1M beta when already present", () => {
    const header = context1MHeader(modelWith({}), `${CONTEXT_1M_BETA_HEADER}`)
    expect(header).toBe(CONTEXT_1M_BETA_HEADER)
  })

  it("skips non-anthropic providers even with a 1M limit", () => {
    const header = context1MHeader(
      modelWith({ providerID: "openai", api: { id: "gpt-5.5-pro", npm: "@ai-sdk/openai" } }),
    )
    expect(header).toBeUndefined()
  })

  it("supports google-vertex-anthropic provider", () => {
    const header = context1MHeader(
      modelWith({ providerID: "google-vertex-anthropic", api: { id: "claude-sonnet-4-6", npm: "@ai-sdk/google-vertex/anthropic" } }),
    )
    expect(header).toBe(CONTEXT_1M_BETA_HEADER)
  })

  it("supports amazon-bedrock anthropic models", () => {
    const header = context1MHeader(
      modelWith({ providerID: "amazon-bedrock", api: { id: "anthropic.claude-sonnet-4-6", npm: "@ai-sdk/amazon-bedrock" } }),
    )
    expect(header).toBe(CONTEXT_1M_BETA_HEADER)
  })

  it("defaults omitted beta to empty (only the 1M beta)", () => {
    const header = context1MHeader(modelWith({}))
    expect(header).toBe(CONTEXT_1M_BETA_HEADER)
  })
})
