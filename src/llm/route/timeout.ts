// LLM HTTP 请求层的超时配置。
//
// 这里必须区分两种完全不同的超时，原因是 `src/llm/route/transport/http.ts` 里
// `frames` 的实现方式：
//
//   Stream.unwrap(runtime.http.execute(prepared.request))
//
// 也就是说 `executor.execute` **只负责拿到响应头**，响应体是 executor 返回之后
// 才被 `framing.frame` 惰性消费的。如果把「总超时」直接套在 `execute` 上，
// 一个正常跑了 3 分钟的长流式推理会被误判为超时并被杀掉——流越长越容易被误杀。
//
// 因此拆成两个独立配置：
//
// 1. 首字节超时（first byte）：只覆盖「发出请求 → 拿到响应头」这一段，
//    套在 `http.execute` 上。provider 接受连接但迟迟不回响应头时快速失败。
//    这一段不涉及响应体，长流式响应拿到头就立刻解除，不会被误杀。
//
// 2. 流空闲超时（stream idle）：覆盖「两个数据块之间的最大间隔」，
//    套在响应体流上，按每次 pull 检查，流一旦产出数据就重新计时。
//    所以总时长可以任意长（长推理不受影响），只有真正卡死才会失败。
//
// 两者的失败都复用 `src/llm/route/executor.ts` 的 `toHttpError` 语义，
// 即 `ProviderInternalReason({ status: 408 })`，不新造错误类型。
import { Effect, Stream } from "effect"
import { LLMError, ProviderInternalReason } from "../schema"

/** 首字节超时默认值：拿不到响应头的最长等待时间。 */
export const DEFAULT_FIRST_BYTE_TIMEOUT_MS = 120_000

/**
 * 流空闲超时默认值。
 *
 * 取 300s（5 分钟）而不是更小的值：深度推理模型（DeepSeek R1 / V3 thinking 等）
 * 在首字节之后仍可能有很长的静默思考段，空闲窗口太短会把正常的长推理打断。
 * 空闲超时只需要覆盖「连接已死但没有报错」这种真正的卡死场景。
 */
export const DEFAULT_STREAM_IDLE_TIMEOUT_MS = 300_000

/** 首字节超时上限，防止有人把环境变量设成极大值后彻底失去超时保护。 */
export const MAX_TIMEOUT_MS = 1_800_000

/** 覆盖首字节超时的环境变量名（毫秒）。 */
export const FIRST_BYTE_TIMEOUT_ENV = "GYC_LLM_FIRST_BYTE_TIMEOUT_MS"

/** 覆盖流空闲超时的环境变量名（毫秒）。 */
export const STREAM_IDLE_TIMEOUT_ENV = "GYC_LLM_STREAM_IDLE_TIMEOUT_MS"

/**
 * 夹取一个超时配置值。
 *
 * 规则与 `src/llm/concurrency.ts` 的 `llmConcurrencyLimit` 保持一致：
 *   - 缺失 / 非数字 / NaN / 小于等于 0 → 回落到默认值
 *   - 超过上限 → 夹到上限
 *   - 其余 → 向下取整
 */
export const timeoutLimit = (raw: string | number | undefined | null, fallback: number): number => {
  if (raw === undefined || raw === null) return fallback
  if (typeof raw === "string" && raw.trim() === "") return fallback
  const parsed = typeof raw === "number" ? raw : Number(raw.trim())
  if (!Number.isFinite(parsed)) return fallback
  const floored = Math.floor(parsed)
  if (floored <= 0) return fallback
  return Math.min(floored, MAX_TIMEOUT_MS)
}

/** 当前生效的首字节超时（毫秒）。 */
export const firstByteTimeoutMs = (): number =>
  timeoutLimit(process.env[FIRST_BYTE_TIMEOUT_ENV], DEFAULT_FIRST_BYTE_TIMEOUT_MS)

/** 当前生效的流空闲超时（毫秒）。 */
export const streamIdleTimeoutMs = (): number =>
  timeoutLimit(process.env[STREAM_IDLE_TIMEOUT_ENV], DEFAULT_STREAM_IDLE_TIMEOUT_MS)

/**
 * 构造结构化的超时失败。
 *
 * 复用 `executor.ts` 的 `toHttpError` 对 `Cause.isTimeoutError` 的映射语义
 * （`ProviderInternalReason({ status: 408 })`，`retryable` 为 true），
 * 这样上层既有的重试路径不需要为超时单独开分支。
 *
 * 为什么在 `orElse` 里直接构造这个 `LLMError`，而不是裸传一个 `Cause.TimeoutError`：
 *
 * `src/llm/route/transport/http.ts` 的 `Stream.mapError` 通过结构化字段读取来识别
 * 「这是一个可重试的结构化传输错误」——它检查 `error.reason._tag === "ProviderInternal"`
 * 且 `error.reason.status === 408`。裸的 `TimeoutError` 没有 `reason` 字段，
 * 只会退化到按 message 文本匹配的兜底分支，最终被包成
 * `InvalidProviderOutputReason`（`:180` 的 `eventError`），408 与「可重试」的语义
 * 全部丢失，上层拿到的就是一个不可重试的 provider 输出错误。
 *
 * 直接构造已映射好的 `LLMError` 则跳过这层误判，最终错误以结构化 408 呈现。
 */
export const timeoutError = (input: {
  readonly message: string
  readonly url?: string | undefined
  readonly method: string
}) =>
  new LLMError({
    module: input.method,
    method: input.method,
    reason: new ProviderInternalReason({
      message: input.message,
      status: 408,
      retryAfterMs: undefined,
      http: undefined,
    }),
  })

/**
 * 给一次 `http.execute` 套上首字节超时。
 *
 * 注意 `Effect.timeout` 的错误类型是 `Cause.TimeoutError`，而 `executor.ts` 的
 * `toHttpError` 已经用 `Cause.isTimeoutError` 把它映射成 408，
 * 所以这里不需要额外映射，把错误类型并入即可。
 */
export const withFirstByteTimeout = <A, E, R>(
  effect: Effect.Effect<A, E, R>,
): Effect.Effect<A, E | import("effect").Cause.TimeoutError, R> =>
  Effect.timeout(effect, firstByteTimeoutMs())

/**
 * 给响应体流套上流空闲超时。
 *
 * 用 `Stream.timeoutOrElse` 而不是 `Stream.timeout`：后者只是「结束流」，
 * 不产出错误，上层会把它当成正常 EOF 处理（当作一次正常结束的响应），
 * 既不会触发重试也不会报错。`timeoutOrElse` 的 `orElse` 分支能显式 `Stream.fail`
 * 出一个结构化错误。
 *
 * 它按每次 pull 检查，流产出数据即重新计时，所以「总时长长但持续有数据」的
 * 长流式响应不会被误杀，只有真正卡死（连接悬挂、provider 半开）才会失败。
 */
export const withStreamIdleTimeout = <A, E>(
  stream: Stream.Stream<A, E>,
  input: { readonly message: string; readonly url?: string | undefined; readonly method: string },
): Stream.Stream<A, E> =>
  Stream.timeoutOrElse(stream, {
    duration: streamIdleTimeoutMs(),
    orElse: () => Stream.fail(timeoutError(input) as unknown as E),
  })