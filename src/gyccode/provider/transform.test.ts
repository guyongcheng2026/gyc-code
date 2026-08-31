import { describe, test, expect } from "bun:test"
import type { ModelMessage } from "ai"
import type { Provider } from "./provider"

function modelWith(over: Partial<Provider.Model["capabilities"]> & { id?: string; providerID?: string }): Provider.Model {
  // mock 只构造被测路径关心的字段，其余以显式断言补齐
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
  } as unknown as Provider.Model
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

describe("normalizeMessages", () => {
  const { normalizeMessages } = require("./transform") as typeof import("./transform")

  type ModelLike = Parameters<typeof normalizeMessages>[1]

  function modelFor(over: Partial<ModelLike["api"]> & { providerID?: string; id?: string; interleaved?: unknown }): ModelLike {
    const base = modelWith({})
    return {
      ...base,
      id: over.id ?? base.id,
      providerID: over.providerID ?? base.providerID,
      api: { ...base.api, id: over.id ?? base.api.id, npm: over.npm ?? base.api.npm },
      capabilities: {
        ...base.capabilities,
        ...(over.interleaved !== undefined ? { interleaved: over.interleaved } : {}),
      },
    } as unknown as ModelLike
  }

  test("sanitizes lone surrogates in user/system/assistant/tool-result text", () => {
    const msgs = [
      { role: "system", content: "a�b" },
      { role: "user", content: "x�y" },
      { role: "assistant", content: [{ type: "text", text: "t�t" }] },
      {
        role: "tool",
        content: [{ type: "tool-result", toolCallId: "t1", output: { type: "text", value: "v�v" } }],
      },
    ] as ModelMessage[]
    const out = normalizeMessages(msgs, modelFor({}), {})
    expect(out[0].content).toBe("a�b")
    expect(out[1].content).toBe("x�y")
    expect((out[2].content as Array<{ type: string; text: string }>)[0].text).toBe("t�t")
    expect((out[3].content as Array<{ type: string; output: { type: string; value: string } }>)[0].output.value).toBe("v�v")
  })

  test("keeps messages unchanged when the provider needs no normalization", () => {
    const msgs = [{ role: "user", content: "plain" }] as ModelMessage[]
    const out = normalizeMessages(msgs, modelFor({ npm: "@ai-sdk/openai" }), {})
    expect(out).toHaveLength(1)
    expect(out[0].content).toBe("plain")
  })

  test("filters empty text parts for anthropic", () => {
    const msgs = [
      { role: "user", content: [{ type: "text", text: "" }, { type: "text", text: "keep" }] },
    ] as ModelMessage[]
    const out = normalizeMessages(msgs, modelFor({ npm: "@ai-sdk/anthropic" }), {})
    const content = out[0].content as Array<{ type: string; text: string }>
    expect(content).toHaveLength(1)
    expect(content[0].text).toBe("keep")
  })

  test("drops messages whose content is entirely empty for anthropic", () => {
    const msgs = [{ role: "user", content: [{ type: "text", text: "" }] }] as ModelMessage[]
    const out = normalizeMessages(msgs, modelFor({ npm: "@ai-sdk/anthropic" }), {})
    expect(out).toHaveLength(0)
  })

  test("keeps reasoning parts with a signature even when text is empty (anthropic)", () => {
    const msgs = [
      {
        role: "assistant",
        content: [
          { type: "reasoning", text: "", providerOptions: { anthropic: { signature: "sig" } } },
          { type: "text", text: "answer" },
        ],
      },
    ] as unknown as ModelMessage[]
    const out = normalizeMessages(msgs, modelFor({ npm: "@ai-sdk/anthropic" }), {})
    const content = out[0].content as Array<{ type: string }>
    expect(content.map((p) => p.type)).toEqual(["reasoning", "text"])
  })

  test("scrubs illegal toolCallId characters for claude", () => {
    const msgs = [
      { role: "assistant", content: [{ type: "tool-call", toolCallId: "a#b c", toolName: "bash", input: {} }] },
    ] as ModelMessage[]
    const out = normalizeMessages(msgs, modelFor({ id: "claude-sonnet-4-6", npm: "@ai-sdk/anthropic" }), {})
    const part = (out[0].content as Array<{ type: string; toolCallId: string }>)[0]
    expect(part.toolCallId).toBe("a_b_c")
  })

  test("compresses toolCallIds to 9 chars for mistral and inserts Done. between tool and user", () => {
    const msgs = [
      {
        role: "assistant",
        content: [{ type: "tool-call", toolCallId: "call-1234567890", toolName: "bash", input: {} }],
      },
      { role: "tool", content: [{ type: "tool-result", toolCallId: "call-1234567890", output: { type: "text", value: "ok" } }] },
      { role: "user", content: "next" },
    ] as ModelMessage[]
    const out = normalizeMessages(msgs, modelFor({ providerID: "mistral", id: "mistral-large" }), {})
    expect(out).toHaveLength(4)
    const first = (out[0].content as Array<{ type: string; toolCallId: string }>)[0]
    expect(first.toolCallId).toMatch(/^[a-zA-Z0-9]{9}$/)
    expect(out[2].role).toBe("assistant")
    expect((out[2].content as Array<{ type: string; text: string }>)[0].text).toBe("Done.")
    expect(out[3].role).toBe("user")
  })

  test("appends an empty reasoning part to assistant messages for deepseek", () => {
    const msgs = [{ role: "assistant", content: "answer" }] as ModelMessage[]
    const out = normalizeMessages(msgs, modelFor({ id: "deepseek-chat", npm: "@ai-sdk/openai-compatible" }), {})
    const content = out[0].content as Array<{ type: string; text: string }>
    expect(content).toEqual([
      { type: "text", text: "answer" },
      { type: "reasoning", text: "" },
    ])
  })

  test("does not duplicate reasoning for deepseek when already present", () => {
    const msgs = [
      { role: "assistant", content: [{ type: "reasoning", text: "thinking" }, { type: "text", text: "answer" }] },
    ] as ModelMessage[]
    const out = normalizeMessages(msgs, modelFor({ id: "deepseek-chat", npm: "@ai-sdk/openai-compatible" }), {})
    expect(out[0].content).toHaveLength(2)
  })

  test("projects reasoning into providerOptions for interleaved providers", () => {
    const msgs = [
      {
        role: "assistant",
        content: [{ type: "reasoning", text: "deep thought" }, { type: "text", text: "answer" }],
      },
    ] as ModelMessage[]
    const out = normalizeMessages(
      msgs,
      modelFor({ id: "deepseek-chat", npm: "@ai-sdk/openai-compatible", interleaved: { field: "reasoning_content" } }),
      {},
    )
    const content = out[0].content as Array<{ type: string }>
    expect(content.map((p) => p.type)).toEqual(["text"])
    const po = (out[0] as { providerOptions?: { openaiCompatible?: Record<string, unknown> } }).providerOptions
    expect(po?.openaiCompatible?.reasoning_content).toBe("deep thought")
  })
})
