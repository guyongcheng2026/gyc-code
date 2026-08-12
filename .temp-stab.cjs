const fs = require("fs")
const path = require("path")
const root = "C:/Users/谷勇成/gyc-cli"
const log = []
const cache = new Map()
const read = (f) => {
  if (cache.has(f)) return cache.get(f)
  const raw = fs.readFileSync(path.join(root, f), "utf8")
  const item = { text: raw.replace(/\r\n/g, "\n"), crlf: raw.includes("\r\n") }
  cache.set(f, item)
  return item
}
const write = (f, s) => {
  const item = cache.get(f) ?? { crlf: false }
  fs.writeFileSync(path.join(root, f), item.crlf ? s.replace(/\n/g, "\r\n") : s)
  log.push("wrote " + f)
}
const replace = (f, before, after, label) => {
  const { text } = read(f)
  if (text.includes(after) && before !== after) { log.push("skip(already) " + label); return }
  if (!text.includes(before)) throw new Error(f + ": anchor not found for " + label + "\n" + before.slice(0, 160))
  write(f, text.replace(before, after))
  log.push("ok " + label)
}

// ===== 1. retry.ts: total retry window cap =====
const rf = "src/gyccode/session/retry.ts"
replace(rf,
`export const MAX_RETRY_ATTEMPTS = 5`,
`export const MAX_RETRY_ATTEMPTS = 5
// Total retry window cap: a provider stuck in 60s header timeouts should not
// stall the run loop for ~6 minutes (60s x 5 attempts). Past this budget we
// fail fast so the user sees an error instead of silence.
export const RETRY_TOTAL_CAP_MS = 120_000 // 2 minutes`,
"retry-cap-const")
replace(rf,
`      const error = opts.parse(meta.input)
      if (meta.attempt > MAX_RETRY_ATTEMPTS) return Cause.done(meta.attempt)
      const retry = retryable(error, opts.provider)`,
`      const error = opts.parse(meta.input)
      if (meta.attempt > MAX_RETRY_ATTEMPTS) return Cause.done(meta.attempt)
      // Elapsed retry budget exceeded: stop silently re-waiting (e.g. 60s
      // header timeouts x 5) and surface the failure to the user promptly.
      if (meta.elapsed > RETRY_TOTAL_CAP_MS) return Cause.done(meta.attempt)
      const retry = retryable(error, opts.provider)`,
"retry-cap-check")

// ===== 2. llm-timeout.ts: first-event timeout =====
const lt = "src/gyccode/session/llm-timeout.ts"
replace(lt,
`export const LLM_MAX_CONCURRENT_STREAMS = 6`,
`/**
 * First-event timeout for LLM streaming responses.
 *
 * Unlike the idle timeout (which resets on every event), this guards the gap
 * between stream start and the *first* event. Providers that accept the
 * connection but never send headers/body would otherwise block the run loop
 * for the whole idle window (10 min). Deep-reasoning models (DeepSeek V4)
 * can take >90s for first token, so the default is 180s; configurable via
 * \`llm.first_token_timeout_ms\`.
 */
export const LLM_FIRST_TOKEN_TIMEOUT_MS = 180_000

export const LLM_MAX_CONCURRENT_STREAMS = 6`,
"llm-timeout-first-token-const")
replace(lt,
`/**
 * Resolve the effective LLM concurrency limit from config, falling back to
 * the default constant.
 */
export function resolveMaxConcurrentStreams(`,
`/**
 * Resolve the effective first-event timeout from config, falling back to the
 * default constant.
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
export function resolveMaxConcurrentStreams(`,
"llm-timeout-resolve-first")
replace(lt,
`export function streamWithIdleTimeout<A, E, R>(
  stream: Stream.Stream<A, E, R>,
  duration: Duration.Input,
): Stream.Stream<A, E, R> {
  return Stream.timeoutOrElse(stream, {
    duration,
    orElse: () =>
      Stream.fail(
        new Error(
          \`LLM stream connection idle timeout: no data received within \${Duration.toMillis(duration)}ms. The connection may have dropped.\`,
        ) as E,
      ),
  })
}`,
`export function streamWithIdleTimeout<A, E, R>(
  stream: Stream.Stream<A, E, R>,
  duration: Duration.Input,
): Stream.Stream<A, E, R> {
  return Stream.timeoutOrElse(stream, {
    duration,
    orElse: () =>
      Stream.fail(
        new Error(
          \`LLM stream connection idle timeout: no data received within \${Duration.toMillis(duration)}ms. The connection may have dropped.\`,
        ) as E,
      ),
  })
}

/**
 * Fail fast when the stream produces no *first* event within \`duration\`.
 * Pulls the first chunk under a timeout, then replays it and continues with
 * the remaining pull (no idle reset here — the outer idle timeout owns that).
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
      const first = yield* Effect.timeout(pull, duration)
      return Stream.concat(Stream.fromIterable(first), Stream.fromPull(() => pull))
    }),
  )
}`,
"llm-timeout-withFirst")

// ===== 3. llm.ts: wire first-event timeout =====
const lf = "src/gyccode/session/llm.ts"
replace(lf,
`import { streamWithIdleTimeout, resolveStreamIdleTimeout, resolveMaxConcurrentStreams } from "./llm-timeout"`,
`import {
  streamWithIdleTimeout,
  withFirstEventTimeout,
  resolveStreamIdleTimeout,
  resolveFirstTokenTimeout,
  resolveMaxConcurrentStreams,
} from "./llm-timeout"`,
"llm-import")
replace(lf,
`            // Adapter seam: both runtimes expose the same LLMEvent stream. Native
            // already returns one; AI SDK streams are converted here.
            const state = LLMAISDK.adapterState()
            return streamWithIdleTimeout(
              Stream.fromAsyncIterable(result.result.fullStream, (e) =>
                e instanceof Error ? e : new Error(String(e)),
              ).pipe(
                Stream.mapEffect((event) => LLMAISDK.toLLMEvents(state, event)),
                Stream.flatMap((events) => Stream.fromIterable(events)),
              ),
              resolveStreamIdleTimeout(cfg),
            )`,
`            // Adapter seam: both runtimes expose the same LLMEvent stream. Native
            // already returns one; AI SDK streams are converted here.
            const state = LLMAISDK.adapterState()
            const converted = Stream.fromAsyncIterable(result.result.fullStream, (e) =>
              e instanceof Error ? e : new Error(String(e)),
            ).pipe(
              Stream.mapEffect((event) => LLMAISDK.toLLMEvents(state, event)),
              Stream.flatMap((events) => Stream.fromIterable(events)),
            )
            return streamWithIdleTimeout(
              // First-event timeout fails fast when the provider accepts the
              // connection but never responds; the idle timeout (reset on every
              // event) stays the guard for mid-stream stalls.
              withFirstEventTimeout(converted, resolveFirstTokenTimeout(cfg)),
              resolveStreamIdleTimeout(cfg),
            )`,
"llm-wire")

// ===== 4. config.ts: first_token_timeout_ms option =====
const cf = "src/core/v1/config/config.ts"
replace(cf,
`      stream_idle_timeout_ms: Schema.optional(PositiveInt).annotate({`,
`      first_token_timeout_ms: Schema.optional(PositiveInt).annotate({
        description:
          "First-event timeout (ms) for LLM streams - fails fast when the provider sends nothing after the stream starts, instead of blocking the run loop for the full idle window (default: 180000)",
      }),
      stream_idle_timeout_ms: Schema.optional(PositiveInt).annotate({`,
"config-first-token")

// ===== 5. tests =====
const rt = "src/gyccode/session/retry.test.ts"
replace(rt,
`import { expect, test } from "bun:test"
import { retryable } from "./retry"`,
`import { expect, test } from "bun:test"
import { retryable, RETRY_TOTAL_CAP_MS } from "./retry"`,
"retry-test-import")
replace(rt,
`test("generic unknown errors are not retryable", () => {`,
`test("RETRY_TOTAL_CAP_MS bounds silent retry windows to ~2 minutes", () => {
  expect(RETRY_TOTAL_CAP_MS).toBe(120_000)
  // 60s header timeout x 5 retries would otherwise stall the run loop ~6min
  expect(RETRY_TOTAL_CAP_MS).toBeLessThan(60_000 * 5)
})

test("generic unknown errors are not retryable", () => {`,
"retry-test-cap")

const lt2 = "src/gyccode/session/llm-timeout.test.ts"
replace(lt2,
`import {
  streamWithIdleTimeout,
  LLM_STREAM_IDLE_TIMEOUT_MS,
  LLM_MAX_CONCURRENT_STREAMS,
  resolveStreamIdleTimeout,
  resolveMaxConcurrentStreams,
} from "./llm-timeout"`,
`import {
  streamWithIdleTimeout,
  withFirstEventTimeout,
  LLM_STREAM_IDLE_TIMEOUT_MS,
  LLM_FIRST_TOKEN_TIMEOUT_MS,
  LLM_MAX_CONCURRENT_STREAMS,
  resolveStreamIdleTimeout,
  resolveFirstTokenTimeout,
  resolveMaxConcurrentStreams,
} from "./llm-timeout"`,
"llm-timeout-test-import")
replace(lt2,
`test("LLM_MAX_CONCURRENT_STREAMS is a positive finite value", () => {`,
`test("LLM_FIRST_TOKEN_TIMEOUT_MS is a positive finite value", () => {
  expect(LLM_FIRST_TOKEN_TIMEOUT_MS).toBeGreaterThan(0)
  expect(Number.isFinite(LLM_FIRST_TOKEN_TIMEOUT_MS)).toBe(true)
})

test("resolveFirstTokenTimeout returns config value when provided", () => {
  expect(resolveFirstTokenTimeout({ llm: { first_token_timeout_ms: 90_000 } })).toBe(90_000)
})

test("resolveFirstTokenTimeout falls back to default when config is absent", () => {
  expect(resolveFirstTokenTimeout({})).toBe(LLM_FIRST_TOKEN_TIMEOUT_MS)
})

test("withFirstEventTimeout passes through a stream that emits values", async () => {
  const s = withFirstEventTimeout(Stream.make(1, 2, 3), "60 seconds")
  const collected = await Effect.runPromise(Stream.runCollect(s))
  expect([...collected]).toEqual([1, 2, 3])
})

test("withFirstEventTimeout fails when no first event arrives before deadline", async () => {
  const s = withFirstEventTimeout(Stream.never, "200 millis")
  const exit = await Effect.runPromise(Effect.exit(Stream.runCollect(s)))
  expect(Exit.isFailure(exit)).toBe(true)
})

test("LLM_MAX_CONCURRENT_STREAMS is a positive finite value", () => {`,
"llm-timeout-test-cases")

console.log(log.join("\n"))
console.log("ALL STABILITY PATCHES OK")
