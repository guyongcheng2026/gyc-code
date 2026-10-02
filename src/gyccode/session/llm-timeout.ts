import { Duration, Effect, Option, Stream } from "effect"

/**
 * Idle timeout for LLM streaming responses.
 *
 * When the network drops or the provider connection is severed, the underlying
 * fetch stream can hang indefinitely (Node's fetch does not time out a stalled
 * connection by default). Without a timeout, the session's runLoop blocks in
 * `Stream.runDrain` forever — every subsequent user message queues behind the
 * stalled request, which manifests as "session became slow after a reconnect".
 *
 * `Stream.timeoutOrElse` is an IDLE timeout: it resets whenever the stream
 * produces a value (text deltas, reasoning deltas, tool calls), so normal long
 * thinking is unaffected. When no value arrives within the window we switch to
 * a failing stream so the processor's error/retry path fires promptly.
 *
 * The default is 600s (10 min) to accommodate deep-reasoning models like
 * DeepSeek V4 (Flash/Pro) whose first-token latency can exceed 90s under
 * heavy load or when routed through a proxy/queue. Users can override via
 * `llm.stream_idle_timeout_ms` in gyccode.json.
 */
export const LLM_STREAM_IDLE_TIMEOUT_MS = 600_000
export const LLM_FIRST_TOKEN_TIMEOUT_MS = 180_000 // 首个事件超时：连接建立后长时间无任何事件则快速失败

/**
 * Max number of LLM streams that may run concurrently across all sessions
 * (main session + subagents + summaries). Ten parallel subagents would
 * otherwise open 10+ concurrent streams against the provider at once; free /
 * queued channels interpret that as load and reply slowly or reset, which is
 * the #1 cause of the idle-timeout errors seen in logs. Extra streams queue
 * for a permit instead of hammering the provider.
 * （低内存机器默认 3，降低并发流内存压力；单会话用户可经 llm.max_concurrent_streams 调高）
 */
export const LLM_MAX_CONCURRENT_STREAMS = 3

/**
 * Resolve the effective stream idle timeout from config, falling back to the
 * default constant. Mirrors the pattern of `resolveOutputTokenMax`.
 */
export function resolveStreamIdleTimeout(
  cfg: { llm?: { stream_idle_timeout_ms?: number } },
): number {
  return cfg.llm?.stream_idle_timeout_ms ?? LLM_STREAM_IDLE_TIMEOUT_MS
}

/**
 * Resolve the effective first-event timeout from config, falling back to the
 * default constant. Fails fast when the provider accepts the connection but
 * never sends a first event.
 */
export function resolveFirstTokenTimeout(
  cfg: { llm?: { first_token_timeout_ms?: number } },
): number {
  return cfg.llm?.first_token_timeout_ms ?? LLM_FIRST_TOKEN_TIMEOUT_MS
}

/**
 * Resolve the effective LLM concurrency limit from config, falling back to
 * the default constant.
 */
export function resolveMaxConcurrentStreams(
  cfg: { llm?: { max_concurrent_streams?: number } },
): number {
  return cfg.llm?.max_concurrent_streams ?? LLM_MAX_CONCURRENT_STREAMS
}

/**
 * 首 token（TTFT）告警阈值。
 *
 * `withFirstEventTimeout` 只负责「首事件有没有来」，从不记录「首事件实际用了
 * 多久」——这导致首 token 体验完全不可观测：慢的时候只能靠用户主观感知。
 * 本阈值用于把慢首 token 显式记入日志，与并发 permit 争用的
 * `waitMs > 200` 属同一类可观测性打点。
 */
export const LLM_TTFT_SLOW_MS = 3_000

/**
 * 记录首 token 时延。
 *
 * 在流的**首块**到达处测量「距 startedAt 的毫秒数」，超过阈值时触发 `onSlow`
 * （默认写 logInfo）。首块会被原样回放，故不改变流内容、不丢块、不重复。
 * 空流不会触发（没有首块就没有 TTFT）。
 *
 * `onSlow` 可注入，便于测试断言而不必捕获日志。
 */
export function withFirstTokenLatency<A, E, R>(
  stream: Stream.Stream<A, E, R>,
  options: {
    readonly startedAt: number
    readonly thresholdMs?: number
    readonly onSlow?: (ttftMs: number) => Effect.Effect<unknown>
  },
): Stream.Stream<A, E, R> {
  const thresholdMs = options.thresholdMs ?? LLM_TTFT_SLOW_MS
  return Stream.unwrap(
    Effect.gen(function* () {
      const pull = yield* Stream.toPull(stream)
      const first = yield* pull
      const ttftMs = Date.now() - options.startedAt
      if (ttftMs > thresholdMs) {
        const report =
          options.onSlow ??
          ((ms: number) =>
            Effect.logInfo("llm first-token latency is slow", { ttftMs: ms, thresholdMs }))
        yield* report(ttftMs)
      }
      return Stream.concat(Stream.fromIterable([first]), Stream.fromPull(Effect.sync(() => pull)))
    }),
  ) as unknown as Stream.Stream<A, E, R>
}
/**
 * Wrap a stream with an idle timeout. If the stream produces no value within
 * `duration`, it is replaced by a stream that fails, so upstream retry/error
 * handling runs instead of hanging.
 */
export function streamWithIdleTimeout<A, E, R>(
  stream: Stream.Stream<A, E, R>,
  duration: Duration.Input,
): Stream.Stream<A, E, R> {
  return Stream.timeoutOrElse(stream, {
    duration,
    orElse: () =>
      Stream.fail(
        new Error(
          `LLM stream connection idle timeout: no data received within ${Duration.toMillis(duration)}ms. The connection may have dropped.`,
        ) as E,
      ),
  })
}

/**
 * Fail fast when the stream produces no *first* event within `duration`.
 * Pulls the first chunk under a timeout, then replays it and continues with
 * the remaining pull (no idle reset here - the outer idle timeout owns that).
 * Prevents a stalled provider connection from blocking the run loop for the
 * full idle window.
 */
export function withFirstEventTimeout<A, E, R>(
  stream: Stream.Stream<A, E, R>,
  duration: Duration.Input,
): Stream.Stream<A, E, R> {
  return Stream.unwrap(
    Effect.gen(function* () {
      const pull = yield* Stream.toPull(stream)
      // P0 修复：Effect.timeout 返回 Option<A>，需要使用 timeoutOption 并正确处理 none 情况
      const first = yield* Effect.timeoutOption(pull, duration)
      // fromPull expects an Effect that yields the pull (not the pull itself)
      return Option.match(first, {
        onNone: () =>
          Stream.fail(
            new Error(`LLM stream first-event timeout: no event received within ${Duration.toMillis(duration)}ms`) as E,
          ),
        onSome: (chunk) => Stream.concat(Stream.fromIterable([chunk]), Stream.fromPull(Effect.sync(() => pull))),
      })
    }),
    // toPull introduces Scope and timeout introduces TimeoutError; both are
    // consumed by the caller (run loop error path / stream scope), so the
    // public signature stays stable.
  ) as unknown as Stream.Stream<A, E, R>
}
