import { describe, expect, test } from "bun:test"
import { Effect } from "effect"
import { LLMAISDK } from "./ai-sdk"

// DeepSeek 自动上下文缓存：usage.prompt_cache_hit_tokens 是顶层字段，
// AI SDK 默认只读 prompt_tokens_details.cached_tokens（DeepSeek 不返回），
// 导致 cacheReadInputTokens=0。本测试验证 gyc 从 providerMetadata.gyccode
// 补读命中 token 的逻辑（对齐 CH 99.9% 机制：命中数据不丢失）。

describe("DeepSeek prompt_cache_hit_tokens 补读", () => {
  test("providerMetadata.gyccode.cacheReadTokens 补进 usage.cacheReadInputTokens", () => {
    const state = LLMAISDK.adapterState()
    const result = LLMAISDK.toLLMEvents(state, {
      type: "finish-step",
      finishReason: "stop",
      usage: { inputTokens: 10000, outputTokens: 500, totalTokens: 10500 },
      providerMetadata: {
        gyccode: { cacheReadTokens: 9800 },
      },
    } as never)

    // toLLMEvents 是 Effect，需要 runSync
    const events = result.pipe(Effect.runSync)
    const finishStep = events[0]
    expect(finishStep.type).toBe("step-finish")
    // @ts-expect-error 测试内部结构
    expect(finishStep.usage.cacheReadInputTokens).toBe(9800)
  })

  test("无 providerMetadata 时保持 AI SDK 原值", () => {
    const state = LLMAISDK.adapterState()
    const result = LLMAISDK.toLLMEvents(state, {
      type: "finish-step",
      finishReason: "stop",
      usage: { inputTokens: 10000, outputTokens: 500, totalTokens: 10500 },
      providerMetadata: undefined,
    } as never)

    const events = result.pipe(Effect.runSync)
    const finishStep = events[0]
    // @ts-expect-error 测试内部结构
    expect(finishStep.usage.cacheReadInputTokens).toBeUndefined()
  })

  test("AI SDK 原生 cached_tokens 与 gyccode 补读取较大值", () => {
    const state = LLMAISDK.adapterState()
    const result = LLMAISDK.toLLMEvents(state, {
      type: "finish-step",
      finishReason: "stop",
      usage: {
        inputTokens: 10000,
        outputTokens: 500,
        totalTokens: 10500,
        inputTokenDetails: { cacheReadTokens: 100, cacheWriteTokens: 0 },
      },
      providerMetadata: {
        gyccode: { cacheReadTokens: 9800 },
      },
    } as never)

    const events = result.pipe(Effect.runSync)
    const finishStep = events[0]
    // @ts-expect-error 测试内部结构
    expect(finishStep.usage.cacheReadInputTokens).toBe(9800)
  })

  test("gyccode.cacheReadTokens 为 0 或缺失时回退 AI SDK 值", () => {
    const state = LLMAISDK.adapterState()
    const result = LLMAISDK.toLLMEvents(state, {
      type: "finish-step",
      finishReason: "stop",
      usage: {
        inputTokens: 10000,
        outputTokens: 500,
        totalTokens: 10500,
        inputTokenDetails: { cacheReadTokens: 200 },
      },
      providerMetadata: { gyccode: { cacheReadTokens: 0 } },
    } as never)

    const events = result.pipe(Effect.runSync)
    const finishStep = events[0]
    // @ts-expect-error 测试内部结构
    expect(finishStep.usage.cacheReadInputTokens).toBe(200)
  })
})
