import { expect, test } from "bun:test"
import { DeepseekV41Encoding, type RenderedPrompt } from "./deepseek-encoding"
import type { Conversation } from "./conversation"

const enc = new DeepseekV41Encoding()

function conv(msgs: Array<{ role: string; content: string }>, overrides?: Partial<Conversation>): Conversation {
  return {
    messages: msgs.map((m) => ({ role: m.role as any, content: [{ type: "text", text: m.content }] })),
    ...overrides,
  }
}

test("renders plain system + user + assistant", () => {
  const result = enc.renderConversation(
    conv([
      { role: "system", content: "You are a helpful assistant" },
      { role: "user", content: "Hello" },
      { role: "assistant", content: "Hi there" },
    ])
  )
  expect(result.system).toBe("You are a helpful assistant")
  expect(result.prompt).toContain("system\nYou are a helpful assistant")
  expect(result.prompt).toContain("user\nHello")
  expect(result.prompt).toContain("assistant\nHi there")
  expect(result.prompt.endsWith("assistant\n")).toBe(true)
})

test("no system section when no system message", () => {
  const result = enc.renderConversation(conv([{ role: "user", content: "Hello" }]))
  expect(result.system).toBe("")
  expect(result.prompt).not.toContain("system\n")
  expect(result.prompt).toContain("user\nHello")
})

test("thinking mode enabled injects instruction", () => {
  const result = enc.renderConversation(
    conv([{ role: "user", content: "Solve this" }], {
      thinking: { mode: "enabled", effort: "high", budgetTokens: 16000 },
    })
  )
  expect(result.system).toContain("Thinking mode: enabled")
  expect(result.system).toContain("effort=high")
  expect(result.system).toContain("budget=16000")
  expect(result.prompt).toContain("Thinking mode: enabled")
})

test("thinking mode disabled injects nothing", () => {
  const result = enc.renderConversation(
    conv([{ role: "user", content: "Solve this" }], {
      thinking: { mode: "disabled" },
    })
  )
  expect(result.system).not.toContain("Thinking mode")
  expect(result.prompt).not.toContain("Thinking mode")
})

test("json_schema format adds structured output constraint", () => {
  const result = enc.renderConversation(
    conv([{ role: "user", content: "Extract" }], {
      format: { type: "json_schema", schema: { type: "object" } },
    })
  )
  expect(result.system).toContain("Structured output")
  expect(result.system).toContain("valid JSON")
  expect(result.prompt).toContain("Structured output")
})

test("regex format adds regex constraint", () => {
  const result = enc.renderConversation(
    conv([{ role: "user", content: "Extract" }], {
      format: { type: "regex", pattern: "\\d+" },
    })
  )
  expect(result.system).toContain("regex: \\d+")
})

test("ebnf format adds grammar constraint", () => {
  const result = enc.renderConversation(
    conv([{ role: "user", content: "Extract" }], {
      format: { type: "ebnf", grammar: "digit ::= \"0\" | \"1\" | \"2\" | \"3\" | \"4\" | \"5\" | \"6\" | \"7\" | \"8\" | \"9\"" },
    })
  )
  expect(result.system).toContain("EBNF grammar")
  expect(result.prompt).toContain("EBNF grammar")
})

test("text format adds no constraint", () => {
  const result = enc.renderConversation(conv([{ role: "user", content: "Hi" }], { format: { type: "text" } }))
  expect(result.system).toBe("")
  expect(result.prompt).not.toContain("Structured output")
  expect(result.prompt).not.toContain("EBNF grammar")
})

test("reasoning content part renders with thinking tags", () => {
  const result = enc.renderConversation({
    messages: [
      { role: "user", content: [{ type: "text", text: "Q" }] },
      { role: "assistant", content: [{ type: "reasoning", text: "I need to think" }] },
    ],
    format: { type: "text" },
  })
  expect(result.prompt).toContain("[thinking]I need to think[/thinking]")
})

test("empty conversation returns empty prompt", () => {
  const result = enc.renderConversation({ messages: [] })
  expect(result.system).toBe("")
  expect(result.prompt).toBe("\n\nassistant\n")
})

test("encodeConversation separates reasoning token count", () => {
  const result = enc.encodeConversation({
    messages: [
      { role: "user", content: [{ type: "text", text: "Hello" }] },
      { role: "assistant", content: [{ type: "reasoning", text: "I am thinking" }] },
    ],
  })
  expect(Array.isArray(result.promptIds)).toBe(true)
  expect(result.promptIds.length).toBeGreaterThan(0)
  expect(typeof result.reasoningTokenCount).toBe("number")
  expect(result.reasoningTokenCount).toBeGreaterThan(0)
})

test("encodeConversation empty returns zero counts", () => {
  const result = enc.encodeConversation({ messages: [] })
  expect(result.promptIds).toEqual([])
  expect(result.reasoningTokenCount).toBe(0)
})

test("logprobs true injects logprob instruction", () => {
  const result = enc.renderConversation(
    conv([{ role: "user", content: "Hi" }], { logprobs: true, topLogprobs: 5 }),
  )
  expect(result.system).toContain("Logprobs")
  expect(result.system).toContain("top_logprobs=5")
  expect(result.prompt).toContain("Logprobs")
})

test("logprobs false/injected nothing", () => {
  const result = enc.renderConversation(conv([{ role: "user", content: "Hi" }]))
  expect(result.system).not.toContain("Logprobs")
})
