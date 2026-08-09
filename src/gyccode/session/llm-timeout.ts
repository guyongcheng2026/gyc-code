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
 */
export const LLM_STREAM_IDLE_TIMEOUT_MS = 90_000

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
