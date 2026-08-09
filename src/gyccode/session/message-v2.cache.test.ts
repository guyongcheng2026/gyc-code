import { expect, test } from "bun:test"
import { aggregateToolCaps, resetTruncationDecisions } from "./message-v2"

function toolPart(callID: string, output: string) {
  return {
    type: "tool",
    callID,
    tool: "bash",
    state: { status: "completed", input: {}, output, title: "t", metadata: {}, time: { start: 0, end: 1 } },
  } as any
}

test("aggregateToolCaps returns undefined when under budget", () => {
  const parts = [toolPart("c1", "small output")]
  expect(aggregateToolCaps(parts as any)).toBeUndefined()
})

test("aggregateToolCaps truncates the largest output over budget", () => {
  const big = "x".repeat(80_000)
  const small = "y".repeat(30_000)
  const parts = [toolPart("c1", small), toolPart("c2", big)]
  const caps = aggregateToolCaps(parts as any)
  expect(caps).toBeDefined()
  // total = 110_000 > 100_000; big one must be truncated to ~keep
  const keep = caps!.get("c2")!
  expect(keep).toBeGreaterThanOrEqual(1_024)
  expect(keep).toBeLessThan(80_000)
  // small one stays intact
  expect(caps!.get("c1")).toBe(30_000)
})

test("aggregateToolCaps is deterministic across repeated calls", () => {
  const parts = [toolPart("c1", "y".repeat(30_000)), toolPart("c2", "x".repeat(80_000))]
  const a = aggregateToolCaps(parts as any)
  const b = aggregateToolCaps(parts as any)
  expect(a).toEqual(b)
})

test("aggregateToolCaps freezes decisions: same callID keeps same keep after re-order", () => {
  resetTruncationDecisions()
  // First call decides c2 (big) gets truncated.
  const p1 = [toolPart("c1", "y".repeat(30_000)), toolPart("c2", "x".repeat(80_000))]
  const caps1 = aggregateToolCaps(p1 as any)
  const keep2 = caps1!.get("c2")!
  // Second call with the same parts must freeze c2's decision.
  const p2 = [toolPart("c2", "x".repeat(80_000)), toolPart("c1", "y".repeat(30_000))]
  const caps2 = aggregateToolCaps(p2 as any)
  expect(caps2!.get("c2")).toBe(keep2)
})
