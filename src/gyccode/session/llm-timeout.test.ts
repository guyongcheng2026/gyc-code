import { expect, test } from "bun:test"
import { Effect, Exit, Stream } from "effect"
import { streamWithIdleTimeout, LLM_STREAM_IDLE_TIMEOUT_MS, resolveStreamIdleTimeout } from "./llm-timeout"

test("LLM_STREAM_IDLE_TIMEOUT_MS is a positive finite value", () => {
  expect(LLM_STREAM_IDLE_TIMEOUT_MS).toBeGreaterThan(0)
  expect(Number.isFinite(LLM_STREAM_IDLE_TIMEOUT_MS)).toBe(true)
})

test("LLM_STREAM_IDLE_TIMEOUT_MS defaults to 300_000 (5 min) for deep-reasoning models", () => {
  expect(LLM_STREAM_IDLE_TIMEOUT_MS).toBe(300_000)
})

test("resolveStreamIdleTimeout returns config value when provided", () => {
  expect(resolveStreamIdleTimeout({ llm: { stream_idle_timeout_ms: 120_000 } })).toBe(120_000)
})

test("resolveStreamIdleTimeout falls back to default when config is absent", () => {
  expect(resolveStreamIdleTimeout({})).toBe(LLM_STREAM_IDLE_TIMEOUT_MS)
  expect(resolveStreamIdleTimeout({ llm: {} })).toBe(LLM_STREAM_IDLE_TIMEOUT_MS)
})

test("streamWithIdleTimeout passes through a stream that emits values", async () => {
  const s = streamWithIdleTimeout(Stream.make(1, 2, 3), "60 seconds")
  const collected = await Effect.runPromise(Stream.runCollect(s))
  expect([...collected]).toEqual([1, 2, 3])
})

test("streamWithIdleTimeout fails the stream when it produces no value before the deadline", async () => {
  // Stream.never produces no value; the timeout should fail it instead of hanging.
  const s = streamWithIdleTimeout(Stream.never, "300 millis")
  const exit = await Effect.runPromise(Effect.exit(Stream.runCollect(s)))
  expect(Exit.isFailure(exit)).toBe(true)
})
