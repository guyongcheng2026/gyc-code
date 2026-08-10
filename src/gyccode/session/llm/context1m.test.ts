import { describe, expect, it } from "bun:test"
import {
  CONTEXT_1M_BETA_HEADER,
  context1MHeader,
  mergeBetaHeader,
  parse1mSuffix,
  effectiveContextWindow,
} from "./context-1m"

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

  it("injects header for a [1m]-suffixed model id even below 1M context", () => {
    const header = context1MHeader(
      modelWith({ api: { id: "claude-sonnet-4-6[1m]", npm: "@ai-sdk/anthropic" }, limit: { context: 200_000, input: 200_000, output: 64_000 } }),
    )
    expect(header).toBe(CONTEXT_1M_BETA_HEADER)
  })
})

describe("mergeBetaHeader", () => {
  it("returns only the token when no existing beta", () => {
    expect(mergeBetaHeader(undefined, CONTEXT_1M_BETA_HEADER)).toBe(CONTEXT_1M_BETA_HEADER)
    expect(mergeBetaHeader("", CONTEXT_1M_BETA_HEADER)).toBe(CONTEXT_1M_BETA_HEADER)
  })
  it("appends the token to existing betas separated by comma", () => {
    expect(mergeBetaHeader("interleaved-thinking-2025-05-14", CONTEXT_1M_BETA_HEADER)).toBe(
      `interleaved-thinking-2025-05-14,${CONTEXT_1M_BETA_HEADER}`,
    )
  })
  it("does not duplicate an already-present token", () => {
    expect(mergeBetaHeader(CONTEXT_1M_BETA_HEADER, CONTEXT_1M_BETA_HEADER)).toBe(CONTEXT_1M_BETA_HEADER)
    expect(mergeBetaHeader(` a, ${CONTEXT_1M_BETA_HEADER} `, CONTEXT_1M_BETA_HEADER)).toBe(
      `a,${CONTEXT_1M_BETA_HEADER}`,
    )
  })
})

describe("parse1mSuffix", () => {
  it("detects [1m] suffix case-insensitively", () => {
    expect(parse1mSuffix("claude-sonnet-4-6[1m]")).toBe(true)
    expect(parse1mSuffix("claude-sonnet-4-6[1M]")).toBe(true)
  })
  it("rejects models without the suffix", () => {
    expect(parse1mSuffix("claude-sonnet-4-6")).toBe(false)
    expect(parse1mSuffix("")).toBe(false)
  })
})

describe("effectiveContextWindow", () => {
  it("returns the env cap when set", () => {
    expect(effectiveContextWindow({ context: 1_000_000 }, { GYCCODE_MAX_CONTEXT_TOKENS: "500000" })).toBe(500000)
  })
  it("returns model context when no env cap", () => {
    expect(effectiveContextWindow({ context: 200_000 }, {})).toBe(200_000)
  })
  it("ignores invalid env values", () => {
    expect(effectiveContextWindow({ context: 200_000 }, { GYCCODE_MAX_CONTEXT_TOKENS: "abc" })).toBe(200_000)
    expect(effectiveContextWindow({ context: 200_000 }, { GYCCODE_MAX_CONTEXT_TOKENS: "-5" })).toBe(200_000)
  })
  it("falls back to 200k when context missing", () => {
    expect(effectiveContextWindow({}, {})).toBe(200_000)
  })
})
