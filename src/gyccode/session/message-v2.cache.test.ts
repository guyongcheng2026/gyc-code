import { expect, test } from "bun:test"
import { aggregateToolCaps, resetTruncationDecisions, cacheFriendlyBudget } from "./message-v2"

function toolPart(callID: string, output: string, tool: string = "bash") {
  return {
    type: "tool",
    callID,
    tool,
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

test("resetTruncationDecisions releases frozen caps after compaction", () => {
  resetTruncationDecisions()
  // First pass: both outputs 60K (total 120K > 100K) -> c1 truncated first
  // (ascending callID), c2 kept intact at 60K.
  const capsA = aggregateToolCaps([toolPart("c1", "x".repeat(60_000)), toolPart("c2", "y".repeat(60_000))] as any)!
  const keepA = capsA.get("c2")!
  expect(keepA).toBe(60_000)
  // Same callIDs, c2 grows to 200K: without reset the frozen cap (60K) wins,
  // so the serialized prefix stays byte-stable (prompt-cache friendly).
  const capsFrozen = aggregateToolCaps([toolPart("c1", "x".repeat(60_000)), toolPart("c2", "y".repeat(200_000))] as any)!
  expect(capsFrozen.get("c2")).toBe(keepA)
  // After compaction resets the frozen decisions, the new output re-decides:
  // c2 now absorbs the excess and is cut harder.
  resetTruncationDecisions()
  const capsB = aggregateToolCaps([toolPart("c1", "x".repeat(60_000)), toolPart("c2", "y".repeat(200_000))] as any)!
  expect(capsB.get("c2")!).toBeLessThan(keepA)
})

test("aggregateToolCaps caps per-tool output with maxPerChar (cache budget)", () => {
  resetTruncationDecisions()
  const parts = [toolPart("c1", "x".repeat(5_000))]
  const caps = aggregateToolCaps(parts as any, { maxPerChar: 1_500, maxTotalChars: 24_000 })
  expect(caps).toBeDefined()
  expect(caps!.get("c1")).toBe(1_500)
})

test("aggregateToolCaps freezes maxPerChar decisions across repeated calls", () => {
  resetTruncationDecisions()
  const p1 = [toolPart("c1", "x".repeat(5_000)), toolPart("c2", "y".repeat(300))]
  const caps1 = aggregateToolCaps(p1 as any, { maxPerChar: 1_500, maxTotalChars: 24_000 })!
  expect(caps1.get("c1")).toBe(1_500)
  expect(caps1.get("c2")).toBe(300)
  // Later call with the same callIDs must keep the frozen cap (prefix byte-stable).
  const caps2 = aggregateToolCaps(p1 as any, { maxPerChar: 1_500, maxTotalChars: 24_000 })!
  expect(caps2.get("c1")).toBe(1_500)
  expect(caps2.get("c2")).toBe(300)
})

test("aggregateToolCaps applies tool-type-aware caps for structured tools", () => {
  resetTruncationDecisions()
  // read 工具（结构化输出）：大窗口下收窄到 2K
  const parts = [toolPart("c-read", "x".repeat(10_000), "read")]
  const caps = aggregateToolCaps(parts as any, { maxPerChar: 8_000, maxTotalChars: 100_000 })
  expect(caps!.get("c-read")).toBe(2_000)
  // bash 工具（命令输出）：保留 8K
  const parts2 = [toolPart("c-bash", "y".repeat(10_000), "bash")]
  const caps2 = aggregateToolCaps(parts2 as any, { maxPerChar: 8_000, maxTotalChars: 100_000 })
  expect(caps2!.get("c-bash")).toBe(8_000)
})

test("cacheFriendlyBudget applies tiered budgets by context window", () => {
  // 小窗口（≤200K）：严格预算
  expect(cacheFriendlyBudget(128_000)).toEqual({ maxPerChar: 1_500, maxTotalChars: 24_000 })
  expect(cacheFriendlyBudget(200_000)).toEqual({ maxPerChar: 1_500, maxTotalChars: 24_000 })
  // 大窗口（200K~1M）：宽松预算（deepseek-v4-flash 实测 1M 窗口，需控制每轮增量）
  expect(cacheFriendlyBudget(1_000_000)).toEqual({ maxPerChar: 8_000, maxTotalChars: 100_000 })
  // 超大窗口（>1M）：不额外收紧
  expect(cacheFriendlyBudget(2_000_000)).toBeUndefined()
  expect(cacheFriendlyBudget(undefined)).toBeUndefined()
})
