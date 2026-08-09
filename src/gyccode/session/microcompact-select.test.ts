import { expect, test } from "bun:test"
import { selectMicrocompactParts, MICROCOMPACT_THRESHOLD, CACHE_PREFIX_KEEP } from "./microcompact-select"
import type { SessionV1 } from "@gyccode/core/v1/session"

function toolPart(callID: string, tool: string): SessionV1.Part {
  return {
    type: "tool",
    callID,
    tool,
    state: { status: "completed", input: {}, output: "x".repeat(1000), title: "t", metadata: {}, time: { start: 0, end: 1 } },
  } as any
}
function userMsg(id: string): SessionV1.Part {
  return { type: "text", id, text: "hi", synthetic: false } as any
}

test("thresholds are exported and sane", () => {
  expect(MICROCOMPACT_THRESHOLD).toBe(0.85)
  expect(CACHE_PREFIX_KEEP).toBe(10)
})

test("selectMicrocompactParts returns empty when usage is below threshold", () => {
  const msgs = [
    { info: { role: "user", id: "u1" }, parts: [userMsg("u1")] },
    { info: { role: "assistant", id: "a1" }, parts: [toolPart("c1", "bash")] },
  ] as any
  expect(selectMicrocompactParts(msgs, 100_000, 200_000)).toEqual([])
})

test("selectMicrocompactParts marks middle tool outputs when usage >= threshold", () => {
  const msgs = Array.from({ length: 20 }, (_, i) => ({
    info: { role: i % 2 === 0 ? "user" : "assistant", id: `m${i}` },
    parts: [i % 2 === 1 ? toolPart(`c${i}`, "bash") : userMsg(`u${i}`)],
  })) as any
  const selected = selectMicrocompactParts(msgs, 180_000, 200_000)
  // Cache prefix (first 10 messages) and last 5 messages are protected.
  expect(selected.length).toBeGreaterThan(0)
  for (const part of selected) {
    expect(part.state.status).toBe("completed")
  }
})

test("selectMicrocompactParts never touches the cache prefix or the tail", () => {
  const msgs = Array.from({ length: 30 }, (_, i) => ({
    info: { role: i % 2 === 0 ? "user" : "assistant", id: `m${i}` },
    parts: [i % 2 === 1 ? toolPart(`c${i}`, "bash") : userMsg(`u${i}`)],
  })) as any
  const selected = selectMicrocompactParts(msgs, 190_000, 200_000)
  const selectedIDs = new Set(selected.map((p: any) => p.callID))
  // First CACHE_PREFIX_KEEP messages must be intact.
  for (let i = 0; i < CACHE_PREFIX_KEEP && i < msgs.length; i++) {
    const msg = msgs[i]
    for (const part of msg.parts) {
      if (part.type === "tool") expect(selectedIDs.has(part.callID)).toBe(false)
    }
  }
  // Last 5 messages must be intact.
  for (let i = Math.max(0, msgs.length - 5); i < msgs.length; i++) {
    const msg = msgs[i]
    for (const part of msg.parts) {
      if (part.type === "tool") expect(selectedIDs.has(part.callID)).toBe(false)
    }
  }
})

test("selectMicrocompactParts protects skill tool outputs", () => {
  const msgs = Array.from({ length: 20 }, (_, i) => ({
    info: { role: i % 2 === 0 ? "user" : "assistant", id: `m${i}` },
    parts: [i % 2 === 1 ? toolPart(`c${i}`, "skill") : userMsg(`u${i}`)],
  })) as any
  const selected = selectMicrocompactParts(msgs, 180_000, 200_000)
  expect(selected.length).toBe(0) // all skill outputs are protected
})

