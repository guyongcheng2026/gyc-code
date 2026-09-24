import { describe, expect, it } from "bun:test"
import { computeChRate, hasTokenUsage, persistedTokens } from "./context-metrics"
import type { AssistantMessage, Message } from "@gyccode/protocol/v2"

function assistant(overrides: Partial<AssistantMessage> = {}): AssistantMessage {
  return {
    id: "msg1",
    role: "assistant",
    sessionID: "ses1",
    time: { created: 0, completed: 1000 },
    cost: 0,
    model: { providerID: "deepseek", modelID: "deepseek-v4-flash" },
    agent: "primary",
    tokens: {
      input: 0,
      output: 0,
      reasoning: 0,
      cache: { read: 0, write: 0 },
    },
    parts: [],
    ...overrides,
  } as AssistantMessage
}

function user(id = "u1"): Message {
  return { id, role: "user", sessionID: "ses1", time: { created: 0 }, parts: [] } as unknown as Message
}

describe("persistedTokens", () => {
  it("sums only completed assistant messages", () => {
    const msgs: Message[] = [
      user(),
      assistant({ tokens: { input: 100, output: 50, reasoning: 30, cache: { read: 500, write: 100 } } }),
      assistant({ time: { created: 0, completed: undefined }, tokens: { input: 999, output: 0, reasoning: 0, cache: { read: 0, write: 0 } } }),
    ]
    expect(persistedTokens(msgs)).toBe(100 + 50 + 30 + 500 + 100)
  })
})

describe("hasTokenUsage", () => {
  it("true when reasoning-only (DeepSeek high-reasoning output=0)", () => {
    const m = assistant({ tokens: { input: 100, output: 0, reasoning: 200, cache: { read: 0, write: 0 } } })
    expect(hasTokenUsage(m)).toBe(true)
  })
  it("false when all zero", () => {
    const m = assistant()
    expect(hasTokenUsage(m)).toBe(false)
  })
})

describe("computeChRate", () => {
  it("returns null with fewer than 2 completed assistant messages", () => {
    expect(computeChRate([user(), assistant()])).toBeNull()
  })

  it("returns null when total input is zero", () => {
    const msgs = [user(), assistant(), assistant()]
    expect(computeChRate(msgs)).toBeNull()
  })

  it("computes actual CH from cache.read / inclusive input", () => {
    const msgs = [
      user(),
      assistant({ tokens: { input: 100, output: 10, reasoning: 0, cache: { read: 900, write: 50 } } }),
      assistant({ tokens: { input: 100, output: 10, reasoning: 0, cache: { read: 800, write: 50 } } }),
    ]
    const r = computeChRate(msgs)
    expect(r).not.toBeNull()
    expect(r!.actual).toBeCloseTo(85, 5)
    expect(r!.theory).toBe(0)
  })

  it("prefix 口径：新增内容不计入，只衡量对上一轮前缀的命中", () => {
    // a1 total=1050；a2 read=1040 ≥0.9×1050（健康轮）但 input=20K 大新增 →
    // actual 被新增拉到 ~9%，prefix 仍按前缀命中 1040/1050 计。
    const msgs = [
      user(),
      assistant({ tokens: { input: 100, output: 0, reasoning: 0, cache: { read: 900, write: 50 } } }),
      assistant({ tokens: { input: 20_000, output: 0, reasoning: 0, cache: { read: 1_040, write: 0 } } }),
    ]
    const r = computeChRate(msgs)
    expect(r).not.toBeNull()
    expect(r!.prefix).toBeCloseTo((1_040 / 1_050) * 100, 3)
    expect(r!.actual).toBeLessThan(20)
  })

  it("prefix 健康稳态：read 命中上一轮全部前缀（含滞后锚小损）→ ≥99.5%", () => {
    const msgs: Message[] = [user()]
    let prevTotal = 0
    for (let i = 0; i < 10; i++) {
      // read = 上一轮 inclusive input − 150（128 块对齐滞后锚损失）；input 为本轮
      // 新增未缓存部分（结构与 session 持久化一致：input 是非缓存净输入）。
      const read = i === 0 ? 90_000 : prevTotal - 150
      const input = 4_000
      msgs.push(assistant({ tokens: { input, output: 0, reasoning: 0, cache: { read, write: 0 } } }))
      prevTotal = input + read
    }
    const r = computeChRate(msgs)
    expect(r).not.toBeNull()
    expect(r!.prefix).toBeGreaterThanOrEqual(99.5)
  })

  it("prefix 剔除漂移事件轮：单轮骤降 >10% 不进稳态分母", () => {
    const msgs = [
      user(),
      // a1: total=10_500（首条不进分母）
      assistant({ tokens: { input: 500, output: 0, reasoning: 0, cache: { read: 10_000, write: 0 } } }),
      // a2: 漂移事件轮 read=2_000 < 0.9×10_500 → 剔除
      assistant({ tokens: { input: 2_000, output: 0, reasoning: 0, cache: { read: 2_000, write: 0 } } }),
      // a3: total(a2)=4_000；read=3_950 ≥ 0.9×4_000 → 计入 3_950/4_000
      assistant({ tokens: { input: 50, output: 0, reasoning: 0, cache: { read: 3_950, write: 0 } } }),
    ]
    const r = computeChRate(msgs)
    expect(r).not.toBeNull()
    expect(r!.prefix).toBeCloseTo((3_950 / 4_000) * 100, 3)
  })

  it("theory approaches 100% as turn count grows", () => {
    const msgs: Message[] = [user()]
    for (let i = 0; i < 100; i++) {
      msgs.push(assistant({ tokens: { input: 50, output: 10, reasoning: 0, cache: { read: 1000, write: 100 } } }))
    }
    const r = computeChRate(msgs)
    expect(r).not.toBeNull()
    expect(r!.theory).toBeCloseTo(98, 5)
  })
})
