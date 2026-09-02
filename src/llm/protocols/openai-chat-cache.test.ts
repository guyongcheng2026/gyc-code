import { expect, test } from "bun:test"
import { Effect, Schema } from "effect"
import { protocol } from "./openai-chat"
import type { LLMRequest } from "../schema"

const decodeEvent = Schema.decodeSync(protocol.stream.event)

function minimalRequest(): LLMRequest {
  return {
    messages: [{ role: "user", parts: [{ type: "text", id: "t1", text: "hi", synthetic: false }] }],
    tools: {},
    toolChoice: undefined,
    system: [],
    model: { providerID: "deepseek", modelID: "deepseek-v4-flash" },
    stop: undefined,
    output: undefined,
  } as unknown as LLMRequest
}

// effect v4 beta 的 Schema/Stream 泛型在测试粘合层无法精确对齐（beta 豁免项的衍生），
// 统一经 unknown 桥接；断言侧仍拿到 protocol 的 finish 事件完整类型。
type Halt = NonNullable<typeof protocol.stream.onHalt>

function runUsage(json: string) {
  const decoded = decodeEvent(json)
  const initial = protocol.stream.initial(minimalRequest())
  const stepEffect = protocol.stream.step(initial, decoded as never) as unknown as Parameters<typeof Effect.runSync>[0]
  const [state] = Effect.runSync(stepEffect) as unknown as readonly [unknown]
  const finishEvents = (protocol.stream.onHalt?.(state as never) ?? []) as ReturnType<Halt>
  return finishEvents.find((e) => e.type === "finish")
}

test("DeepSeek prompt_cache_hit_tokens maps to cacheReadInputTokens", () => {
  const finish = runUsage(JSON.stringify({
    id: "cmpl-1",
    object: "chat.completion.chunk",
    model: "deepseek-v4-flash",
    choices: [{ index: 0, delta: {}, finish_reason: "stop" }],
    usage: {
      prompt_tokens: 10000,
      completion_tokens: 500,
      total_tokens: 10500,
      prompt_cache_hit_tokens: 9800,
      prompt_cache_miss_tokens: 200,
    },
  }))!
  expect(finish).toBeDefined()
  expect(finish.usage?.cacheReadInputTokens).toBe(9800)
  expect(finish.usage?.inputTokens).toBe(10000)
  expect(finish.usage?.nonCachedInputTokens).toBe(200)
})

test("OpenAI-native cached_tokens still maps correctly", () => {
  const finish = runUsage(JSON.stringify({
    id: "cmpl-1",
    object: "chat.completion.chunk",
    model: "gpt-4",
    choices: [{ index: 0, delta: {}, finish_reason: "stop" }],
    usage: {
      prompt_tokens: 10000,
      completion_tokens: 500,
      total_tokens: 10500,
      prompt_tokens_details: { cached_tokens: 9000 },
    },
  }))!
  expect(finish).toBeDefined()
  expect(finish.usage?.cacheReadInputTokens).toBe(9000)
  expect(finish.usage?.inputTokens).toBe(10000)
})
