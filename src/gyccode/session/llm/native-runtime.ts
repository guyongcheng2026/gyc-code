import type { Auth } from "@/auth"
import type { Provider } from "@/provider/provider"
import { ProviderTransform } from "@/provider/transform"
import { errorMessage } from "@/util/error"
import { isRecord } from "@/util/record"
import { asSchema, type ModelMessage, type Tool } from "ai"
import { Cause, Duration, Effect, FiberSet, JsonSchema, Queue } from "effect"
import * as Stream from "effect/Stream"
import { FetchHttpClient } from "effect/unstable/http"
import {
  LLMRequest,
  Tool as NativeTool,
  ToolFailure,
  ToolRuntime,
  toDefinitions,
  type LLMEvent,
  type ToolExecuteContext,
} from "@gyccode/llm"
import type { LLMClientShape } from "@gyccode/llm/route"
import { LLMNative } from "./native-request"

export type RuntimeStatus =
  | { readonly type: "supported"; readonly apiKey: string; readonly baseURL?: string }
  | { readonly type: "unsupported"; readonly reason: string }
export type StreamResult =
  | { readonly type: "supported"; readonly stream: Stream.Stream<LLMEvent, unknown> }
  | { readonly type: "unsupported"; readonly reason: string }

type StreamInput = {
  readonly model: Provider.Model
  readonly provider: Provider.Info
  readonly auth: Auth.Info | undefined
  readonly llmClient: LLMClientShape
  readonly messages: ModelMessage[]
  readonly tools: Record<string, Tool>
  readonly toolChoice?: "auto" | "required" | "none"
  readonly temperature?: number
  readonly topP?: number
  readonly topK?: number
  readonly maxOutputTokens?: number
  readonly providerOptions?: Record<string, any>
  readonly headers: Record<string, string>
  readonly abort: AbortSignal
}

export function status(input: Pick<StreamInput, "model" | "provider" | "auth">): RuntimeStatus {
  return statusWithFetch(input, providerFetch(input))
}

function statusWithFetch(
  input: Pick<StreamInput, "model" | "provider" | "auth">,
  fetch: typeof globalThis.fetch | undefined,
): RuntimeStatus {
  const providerID = input.model.providerID
  if (providerID !== "openai" && providerID !== "anthropic" && !providerID.startsWith("gyccode"))
    return { type: "unsupported", reason: "provider is not openai, gyccode, or anthropic" }
  const npm = input.model.api.npm
  if (npm !== "@ai-sdk/openai" && npm !== "@ai-sdk/openai-compatible" && npm !== "@ai-sdk/anthropic")
    return { type: "unsupported", reason: "provider package is not OpenAI, OpenAI-compatible, or Anthropic" }
  if (input.auth?.type === "oauth" && !(input.provider.id === "openai" && fetch)) {
    return { type: "unsupported", reason: "OAuth auth requires a provider fetch override" }
  }

  const apiKey = typeof input.provider.options.apiKey === "string" ? input.provider.options.apiKey : input.provider.key
  if (!apiKey) return { type: "unsupported", reason: "API key is not configured" }

  return {
    type: "supported",
    apiKey,
    baseURL: typeof input.provider.options.baseURL === "string" ? input.provider.options.baseURL : undefined,
  }
}

export function stream(input: StreamInput): StreamResult {
  const fetch = providerFetch(input)
  const current = statusWithFetch(input, fetch)
  if (current.type === "unsupported") return current

  // Integration point with @gyccode/llm: native-request lowers session data
  // into an LLMRequest, then LLMClient handles route selection and transport.
  //
  // ProviderTransform.providerOptions builds AI-SDK-shaped options for the
  // selected SDK key (e.g. "openai") and the native LLM SDK reads the same
  // keys via OpenAIOptions.* (store, reasoningEffort, reasoningSummary,
  // include, textVerbosity, promptCacheKey). Both sides intentionally use
  // OpenAI's official wire field names, so this is identity, not translation
  // — if a field ever needs to differ between the two surfaces, the
  // translation belongs here, not split across both packages.
  const tools = nativeTools(input.tools, input)
  const request = LLMNative.request({
    model: input.model,
    apiKey: current.apiKey,
    baseURL: current.baseURL,
    messages: ProviderTransform.message(input.messages, input.model, input.providerOptions ?? {}),
    toolChoice: input.toolChoice,
    temperature: input.temperature,
    topP: input.topP,
    topK: input.topK,
    maxOutputTokens: input.maxOutputTokens,
    providerOptions: ProviderTransform.providerOptions(input.model, input.providerOptions ?? {}),
    headers: { ...providerHeaders(input.provider.options.headers), ...input.headers },
  })
  const base = Stream.scoped(
    Stream.unwrap(
      Effect.gen(function* () {
        const settlements = yield* FiberSet.make<void>()
        const results = yield* Queue.unbounded<LLMEvent, Cause.Done>()
        const provider = input.llmClient
          .stream(
            LLMRequest.update(request, {
              tools: [...request.tools, ...toDefinitions(tools)],
            }),
          )
          .pipe(
            Stream.flatMap((event) =>
              event.type !== "tool-call" || event.providerExecuted
                ? Stream.make(event)
                : Stream.make(event).pipe(
                    Stream.concat(
                      Stream.fromEffectDrain(
                        ToolRuntime.dispatch(tools, event).pipe(
                          Effect.flatMap((dispatched) => Queue.offerAll(results, dispatched.events)),
                          Effect.catchCause((cause) => Queue.failCause(results, cause)),
                          Effect.asVoid,
                          FiberSet.run(settlements, { startImmediately: true }),
                        ),
                      ),
                    ),
                  ),
            ),
            Stream.concat(
              Stream.fromEffectDrain(
                FiberSet.awaitEmpty(settlements).pipe(Effect.andThen(Queue.end(results)), Effect.asVoid),
              ),
            ),
          )
        return provider.pipe(Stream.concat(Stream.fromQueue(results)))
      }),
    ),
  )

  // 详见 retryBeforeFirstEvent 的方案说明：只重试「首包到达前」的失败。
  const stream = retryBeforeFirstEvent(
    () => base,
    (error) => !input.abort.aborted && isRetryableStreamError(error),
    STREAM_RETRY_BACKOFF_MS,
  )

  return {
    ...current,
    stream: fetch ? stream.pipe(Stream.provideService(FetchHttpClient.Fetch, fetch)) : stream,
  }
}

// 首包前重试的退避序列：第 1 次失败等 1s，第 2 次等 3s，最多重试 2 次。
const STREAM_RETRY_BACKOFF_MS: ReadonlyArray<number> = [1_000, 3_000]

// 累计退避上限：与 executor.ts 的 HTTP 层退避叠加后，若不设总闸，最坏等待
// = 内层(0.5s+1s)*jitter + 外层(1s+3s) ≈ 8.5s，远超「首条回复 ≤1s」的可接受范围。
// 超过本预算就不再重试，直接把错误上抛让用户看到真实原因。
const STREAM_RETRY_BUDGET_MS = 3_000

// 明确不可重试：用户取消/中断，以及 4xx 类（认证、授权、参数、上下文长度、内容过滤）。
// 错误码一律带边界（\b...\b）：裸数字会命中请求 ID、耗时、端口等无关片段
// （例如 "request 4021 took 503ms" 会被误判成 402/503 错误）。
const NON_RETRYABLE_ERROR_PATTERN =
  /\b(?:abort|cancell?ed|unauthorized|forbidden|bad request|not found|invalid|400|401|403|404|405|413|422)\b|context length|content filter|moderation|too large/i

// 可重试：限流、provider 过载/5xx、超时、网络中断。数字同样加边界。
const RETRYABLE_ERROR_PATTERN =
  /rate.?limit|\b429\b|overloaded|too many requests|gone|timeout|timed.?out|econnreset|etimedout|econnrefused|epipe|socket hang up|fetch failed|network|connection (?:reset|closed|refused|error)|bad gateway|service unavailable|gateway time-?out|\b50[234]\b|internal server error/i

function isRetryableStreamError(error: unknown): boolean {
  const text = errorMessage(error)
  if (NON_RETRYABLE_ERROR_PATTERN.test(text)) return false
  return RETRYABLE_ERROR_PATTERN.test(text)
}

/**
 * 有限指数退避重试：只在「首包到达前」失败时重跑整条生成流，退避 backoffMs。
 *
 * 为什么是「首包前重试」而不是「全流重试」：
 * 1) `input.llmClient.stream(request)` 返回惰性 Stream，真正的 HTTP 建连与首包
 *    发生在消费期而非建流期，所以重试必须包在最终合并流外层才拦得住网络类错误；
 *    而一旦已有事件 yield 出，重放整条流会把已产出的 token 二次推给 agent
 *    （重复文本 + 重复工具调用），无法回退。因此用 `emitted` 守卫把重试窗口
 *    压到首包为止，事件一旦产出即原样透传、失败直接上抛。
 * 2) 工具派发失败（Queue.failCause）必然发生在 tool-call 事件已发出之后，
 *    天然落在守卫之外，不会重放工具副作用。
 */
function retryBeforeFirstEvent<A, E, R>(
  make: () => Stream.Stream<A, E, R>,
  shouldRetry: (error: E) => boolean,
  backoffMs: ReadonlyArray<number>,
): Stream.Stream<A, E, R> {
  // spent：本次 stream 已累计的退避时长。跨 attempt 传递（不放在 attempt 内部），
  // 否则每轮重试都会重置预算，预算闸形同虚设。
  let spent = 0
  const attempt = (index: number): Stream.Stream<A, E, R> => {
    let emitted = false
    return Stream.suspend(() =>
      make().pipe(
        Stream.map((event) => {
          emitted = true
          return event
        }),
        Stream.catch((error): Stream.Stream<A, E, R> => {
          const delay = backoffMs[index]
          if (emitted || delay === undefined || !shouldRetry(error)) return Stream.fail(error)
          if (spent + delay > STREAM_RETRY_BUDGET_MS) {
            return Stream.fromEffect(
              Effect.logError(
                `[native-runtime] LLM stream retry budget exhausted (${spent}ms/${STREAM_RETRY_BUDGET_MS}ms), giving up`,
              ),
            ).pipe(Stream.flatMap(() => Stream.fail(error)))
          }
          spent += delay
          return Stream.fromEffect(
            Effect.gen(function* () {
              yield* Effect.logError(
                `[native-runtime] LLM stream failed before first event (${errorMessage(error)}), retrying in ${delay}ms`,
              )
              yield* Effect.sleep(Duration.millis(delay))
            }),
          ).pipe(Stream.flatMap(() => attempt(index + 1)))
        }),
      ),
    )
  }

  return attempt(0)
}

function providerFetch(input: Pick<StreamInput, "provider" | "auth">): typeof globalThis.fetch | undefined {
  if (input.provider.id !== "openai" || input.auth?.type !== "oauth") return undefined
  const value: unknown = input.provider.options.fetch
  if (typeof value !== "function") return undefined
  return value as typeof globalThis.fetch
}

function providerHeaders(value: unknown): Record<string, string> | undefined {
  if (!isRecord(value)) return undefined
  return Object.fromEntries(
    Object.entries(value).filter((entry): entry is [string, string] => typeof entry[1] === "string"),
  )
}

function nativeSchema(value: unknown): JsonSchema.JsonSchema {
  if (!value || typeof value !== "object") return { type: "object", properties: {} }
  if ("jsonSchema" in value && value.jsonSchema && typeof value.jsonSchema === "object")
    return value.jsonSchema as unknown as JsonSchema.JsonSchema
  return asSchema(value as Parameters<typeof asSchema>[0]).jsonSchema as unknown as JsonSchema.JsonSchema
}

export function nativeTools(tools: Record<string, Tool>, input: Pick<StreamInput, "messages" | "abort">) {
  return Object.fromEntries(
    Object.entries(tools).map(([name, item]) => [
      name,
      // Tool execution remains gyccode-owned. The native runtime only adapts
      // the @gyccode/llm tool call back into the AI SDK Tool.execute shape.
      NativeTool.make({
        description: typeof item.description === "string" ? item.description : "",
        jsonSchema: nativeSchema(item.inputSchema),
        execute: (args: unknown, ctx?: ToolExecuteContext) =>
          Effect.tryPromise({
            try: () => {
              if (!item.execute) throw new Error(`Tool has no execute handler: ${name}`)
              return Promise.resolve(
                item.execute(args, {
                  toolCallId: ctx?.id ?? name,
                  messages: input.messages,
                  abortSignal: input.abort,
                  context: undefined,
                }),
              ) as Promise<unknown>
            },
            catch: (error) => new ToolFailure({ message: errorMessage(error), error }),
          }),
      }),
    ]),
  )
}

export * as LLMNativeRuntime from "./native-runtime"
