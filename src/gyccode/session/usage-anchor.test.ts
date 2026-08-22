import { expect, test } from "bun:test"
import { findUsageAnchor } from "./compaction"
import type { SessionV1 } from "@gyccode/core/v1/session"

function stepFinish(tokens: {
  input: number
  output: number
  reasoning?: number
  cacheRead?: number
  cacheWrite?: number
}): SessionV1.Part {
  return {
    type: "step-finish",
    reason: "stop",
    cost: 0,
    tokens: {
      input: tokens.input,
      output: tokens.output,
      reasoning: tokens.reasoning ?? 0,
      cache: { read: tokens.cacheRead ?? 0, write: tokens.cacheWrite ?? 0 },
    },
  } as any
}

function textPart(id: string): SessionV1.Part {
  return { type: "text", id, text: "hi", synthetic: false } as any
}

test("no anchor when there are no assistant messages", () => {
  const msgs = [{ info: { role: "user", id: "u1" }, parts: [textPart("u1")] }] as any
  const { anchorTokens, toEstimate } = findUsageAnchor(msgs)
  expect(anchorTokens).toBe(0)
  expect(toEstimate).toEqual(msgs)
})

test("no anchor when assistant has no step-finish part", () => {
  const msgs = [
    { info: { role: "user", id: "u1" }, parts: [textPart("u1")] },
    { info: { role: "assistant", id: "a1" }, parts: [textPart("a1")] },
  ] as any
  const { anchorTokens, toEstimate } = findUsageAnchor(msgs)
  expect(anchorTokens).toBe(0)
  expect(toEstimate).toEqual(msgs)
})

test("no anchor when step-finish has zero usage", () => {
  const msgs = [
    { info: { role: "user", id: "u1" }, parts: [textPart("u1")] },
    {
      info: { role: "assistant", id: "a1" },
      parts: [stepFinish({ input: 0, output: 0 })],
    },
  ] as any
  const { anchorTokens, toEstimate } = findUsageAnchor(msgs)
  expect(anchorTokens).toBe(0)
  expect(toEstimate).toEqual(msgs)
})

test("anchor uses the last assistant message with real usage", () => {
  const msgs = [
    { info: { role: "user", id: "u1" }, parts: [textPart("u1")] },
    {
      info: { role: "assistant", id: "a1" },
      parts: [stepFinish({ input: 100, output: 10 })],
    },
    { info: { role: "user", id: "u2" }, parts: [textPart("u2")] },
    {
      info: { role: "assistant", id: "a2" },
      parts: [stepFinish({ input: 200, output: 20 })],
    },
    { info: { role: "user", id: "u3" }, parts: [textPart("u3")] },
  ] as any
  const { anchorTokens, toEstimate } = findUsageAnchor(msgs)
  // anchor = input(200) + cache(0) + output(20) + reasoning(0)
  expect(anchorTokens).toBe(220)
  // only the message after the anchor needs local estimation
  expect(toEstimate).toHaveLength(1)
  expect(String(toEstimate[0].info.id)).toBe("u3")
})

test("anchor includes cache read/write and reasoning tokens", () => {
  const msgs = [
    { info: { role: "user", id: "u1" }, parts: [textPart("u1")] },
    {
      info: { role: "assistant", id: "a1" },
      parts: [stepFinish({ input: 100, output: 30, reasoning: 15, cacheRead: 50, cacheWrite: 25 })],
    },
  ] as any
  const { anchorTokens, toEstimate } = findUsageAnchor(msgs)
  // anchor = input(100) + cacheRead(50) + cacheWrite(25) + output(30) + reasoning(15)
  expect(anchorTokens).toBe(220)
  expect(toEstimate).toHaveLength(0)
})

test("multi-step assistant message uses the last step-finish part", () => {
  const msgs = [
    { info: { role: "user", id: "u1" }, parts: [textPart("u1")] },
    {
      info: { role: "assistant", id: "a1" },
      parts: [
        stepFinish({ input: 100, output: 10 }),
        stepFinish({ input: 300, output: 40 }),
      ],
    },
  ] as any
  const { anchorTokens, toEstimate } = findUsageAnchor(msgs)
  // anchor = input(300) + output(40)
  expect(anchorTokens).toBe(340)
  expect(toEstimate).toHaveLength(0)
})

test("skips assistant messages without usage and anchors on an earlier one", () => {
  const msgs = [
    { info: { role: "user", id: "u1" }, parts: [textPart("u1")] },
    {
      info: { role: "assistant", id: "a1" },
      parts: [stepFinish({ input: 500, output: 50 })],
    },
    { info: { role: "user", id: "u2" }, parts: [textPart("u2")] },
    // assistant with no step-finish (e.g. aborted)
    { info: { role: "assistant", id: "a2" }, parts: [textPart("a2")] },
  ] as any
  const { anchorTokens, toEstimate } = findUsageAnchor(msgs)
  expect(anchorTokens).toBe(550)
  // everything after a1 needs estimation: u2 + a2
  expect(toEstimate).toHaveLength(2)
  expect(String(toEstimate[0].info.id)).toBe("u2")
  expect(String(toEstimate[1].info.id)).toBe("a2")
})
