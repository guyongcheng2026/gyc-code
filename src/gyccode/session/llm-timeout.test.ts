import { expect, test } from "bun:test"
import { Effect, Exit, Stream } from "effect"
import {
  streamWithIdleTimeout,
  LLM_STREAM_IDLE_TIMEOUT_MS,
  LLM_MAX_CONCURRENT_STREAMS,
  resolveStreamIdleTimeout,
  resolveMaxConcurrentStreams,
} from "./llm-timeout"

test("LLM_STREAM_IDLE_TIMEOUT_MS is a positive finite value", () => {
  expect(LLM_STREAM_IDLE_TIMEOUT_MS).toBeGreaterThan(0)
  expect(Number.isFinite(LLM_STREAM_IDLE_TIMEOUT_MS)).toBe(true)
})

test("LLM_STREAM_IDLE_TIMEOUT_MS defaults to 600_000 (10 min) for deep-reasoning models", () => {
  expect(LLM_STREAM_IDLE_TIMEOUT_MS).toBe(600_000)
})

test("resolveStreamIdleTimeout returns config value when provided", () => {
  expect(resolveStreamIdleTimeout({ llm: { stream_idle_timeout_ms: 120_000 } })).toBe(120_000)
})

test("resolveStreamIdleTimeout falls back to default when config is absent", () => {
  expect(resolveStreamIdleTimeout({})).toBe(LLM_STREAM_IDLE_TIMEOUT_MS)
  expect(resolveStreamIdleTimeout({ llm: {} })).toBe(LLM_STREAM_IDLE_TIMEOUT_MS)
})

test("LLM_FIRST_TOKEN_TIMEOUT_MS is a positive finite value", () => {
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

test("LLM_MAX_CONCURRENT_STREAMS is a positive finite value", () => {
  expect(LLM_MAX_CONCURRENT_STREAMS).toBeGreaterThan(0)
  expect(Number.isFinite(LLM_MAX_CONCURRENT_STREAMS)).toBe(true)
})

test("resolveMaxConcurrentStreams returns config value when provided", () => {
  expect(resolveMaxConcurrentStreams({ llm: { max_concurrent_streams: 3 } })).toBe(3)
})

test("resolveMaxConcurrentStreams falls back to default when config is absent", () => {
  expect(resolveMaxConcurrentStreams({})).toBe(LLM_MAX_CONCURRENT_STREAMS)
  expect(resolveMaxConcurrentStreams({ llm: {} })).toBe(LLM_MAX_CONCURRENT_STREAMS)
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
