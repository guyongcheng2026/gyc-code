import { expect, test } from "bun:test"
import {
  aggregateToolCaps,
  resetTruncationDecisions,
  cacheFriendlyBudget,
  toolCapForOutput,
  TRUNCATION_DECISIONS_MAX,
  truncationDecisionsSize,
} from "./message-v2"

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
  // small one 未被聚合截断 → 不在 Map，交给调用方 fallback（统一契约：Map 仅含真实截断）
  expect(caps!.get("c1")).toBeUndefined()
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
  // (ascending callID), c2 kept intact at full 60K.
  const pA = [toolPart("c1", "x".repeat(60_000)), toolPart("c2", "y".repeat(60_000))]
  const capsA = aggregateToolCaps(pA as any)!
  // c1 真实截断到 40K；c2 保持全长 → 不在 Map（统一契约，走 fallback）
  expect(capsA.get("c1")!).toBe(40_000)
  expect(capsA.get("c2")).toBeUndefined()
  // 模拟调用方有效 cap：c2 未截断且无 per-char 上限 → 全文
  expect(toolCapForOutput(capsA, "c2", "y".repeat(60_000), "bash", undefined)).toBeUndefined()
  // Same callIDs, c2 grows to 200K: frozen decision (60K, its original full length) wins,
  // so the serialized prefix stays byte-stable (prompt-cache friendly).
  const capsFrozen = aggregateToolCaps([toolPart("c1", "x".repeat(60_000)), toolPart("c2", "y".repeat(200_000))] as any)!
  expect(capsFrozen.get("c2")).toBe(60_000)
  // After compaction resets the frozen decisions, the new output re-decides:
  // c2 now absorbs the excess and is cut harder.
  resetTruncationDecisions()
  const capsB = aggregateToolCaps([toolPart("c1", "x".repeat(60_000)), toolPart("c2", "y".repeat(200_000))] as any)!
  expect(capsB.get("c2")!).toBeLessThan(60_000)
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
  // c1 被 per-char 截断 → 在 Map；c2 未被截断 → 不在 Map（统一契约）
  expect(caps1.get("c1")).toBe(1_500)
  expect(caps1.get("c2")).toBeUndefined()
  // Later call with the same callIDs must keep the frozen cap (prefix byte-stable).
  const caps2 = aggregateToolCaps(p1 as any, { maxPerChar: 1_500, maxTotalChars: 24_000 })!
  expect(caps2.get("c1")).toBe(1_500)
  expect(caps2.get("c2")).toBeUndefined()
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

test("toolCapForOutput 二次序列化仍回退类型上限（Bug 1 回归）", () => {
  resetTruncationDecisions()
  const output = "x".repeat(10_000)
  // 统一契约下：两次序列化都返回 undefined（无真实截断）→ 调用方均走类型上限 fallback，
  // 跨轮字节稳定（此前第二次返回含全长度条目的 Map 压制 fallback）。
  const caps1 = aggregateToolCaps([toolPart("c1", output, "read")] as any)
  expect(caps1).toBeUndefined()
  expect(toolCapForOutput(caps1, "c1", output, "read", 2_000)).toBe(2_000)
  const caps2 = aggregateToolCaps([toolPart("c1", output, "read")] as any)
  expect(caps2).toBeUndefined()
  expect(toolCapForOutput(caps2, "c1", output, "read", 2_000)).toBe(2_000)
})

test("toolCapForOutput 聚合真实截断优先于类型上限", () => {
  resetTruncationDecisions()
  // over-budget：c2(80K) 被聚合截断，c1(30K) 保持全长
  const caps = aggregateToolCaps([
    toolPart("c1", "y".repeat(30_000), "bash"),
    toolPart("c2", "x".repeat(80_000), "bash"),
  ] as any)!
  const output2 = "x".repeat(80_000)
  const keep = caps.get("c2")!
  expect(keep).toBeGreaterThanOrEqual(1_024)
  expect(keep).toBeLessThan(80_000)
  // 真实截断 → 用聚合 cap
  expect(toolCapForOutput(caps, "c2", output2, "bash", 2_000)).toBe(keep)
  // c1 未被聚合截断（cap=全长）→ 回退类型上限（Bug 4）
  expect(toolCapForOutput(caps, "c1", "y".repeat(30_000), "read", 2_000)).toBe(2_000)
  // 无聚合决策 → 回退类型上限（read 类型上限 2000 优先于 base 8000）
  expect(toolCapForOutput(undefined, "cX", output2, "read", 8_000)).toBe(2_000)
  // 无类型上限 → undefined（不截断）
  expect(toolCapForOutput(undefined, "cX", output2, "read", undefined)).toBeUndefined()
})

test("aggregateToolCaps 仅传 maxTotalChars 时执行聚合预算（Bug 2 生产模式）", () => {
  resetTruncationDecisions()
  // 生产接线后：aggregateToolCaps(parts, { maxTotalChars }) 仅约束聚合总量
  const parts = [
    toolPart("c1", "y".repeat(10_000), "bash"),
    toolPart("c2", "x".repeat(10_000), "bash"),
    toolPart("c3", "z".repeat(10_000), "bash"),
  ]
  // total = 30_000 > 24_000 → 聚合截断生效
  const caps = aggregateToolCaps(parts as any, { maxTotalChars: 24_000 })
  expect(caps).toBeDefined()
  const keepSum = [...caps!.values()].reduce((a, b) => a + b, 0)
  expect(keepSum).toBeLessThanOrEqual(24_000)
  // under 预算 → undefined（调用方 fallback 处理 per-tool 上限）
  const capsUnder = aggregateToolCaps([toolPart("c4", "small")] as any, { maxTotalChars: 24_000 })
  expect(capsUnder).toBeUndefined()
})

test("truncationDecisions 有界化：超过上限后清空，不随调用数无限增长（Bug 3 回归）", () => {
  resetTruncationDecisions()
  // 灌入超过上限的独立 callID（每个 under-budget 都会冻结一条决策）
  for (let i = 0; i < TRUNCATION_DECISIONS_MAX + 20; i++) {
    aggregateToolCaps([toolPart(`bulk-${i}`, "x".repeat(100))] as any)
  }
  // 有界：数量不超过上限
  expect(truncationDecisionsSize()).toBeLessThanOrEqual(TRUNCATION_DECISIONS_MAX)
  // 有界后新 callID 仍能正常决策（不会因残留旧决策而失效）
  resetTruncationDecisions()
  expect(aggregateToolCaps([toolPart("fresh", "x".repeat(100))] as any)).toBeUndefined()
})
