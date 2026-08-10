import { Duration, Effect, Stream } from "effect"

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
 * The default is 300s (5 min) to accommodate deep-reasoning models like
 * DeepSeek V4 Pro whose first-token latency can exceed 90s under heavy load.
 * Users can override via `llm.stream_idle_timeout_ms` in gyccode.json.
 */
export const LLM_STREAM_IDLE_TIMEOUT_MS = 300_000

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
