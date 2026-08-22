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
