import { expect, test } from "bun:test"
import { resetTruncationDecisions, toModelMessages } from "./message-v2"

// 从被测函数签名反推 mock 类型，避免 any
type TestWithParts = Parameters<typeof toModelMessages>[0]
type TestModel = Parameters<typeof toModelMessages>[1]
type TestModelMsg = Awaited<ReturnType<typeof toModelMessages>>[number]

const model = {
  providerID: "test-provider",
  id: "test-model",
  api: { npm: "@ai-sdk/openai", id: "test-api" },
} as unknown as TestModel

function toolPart(callID: string, output: string, tool: string = "read") {
  return {
    type: "tool",
    callID,
    tool,
    state: { status: "completed", input: {}, output, title: "t", metadata: {}, time: { start: 0, end: 1 } },
  }
}

function messages(toolParts: ReturnType<typeof toolPart>[]): TestWithParts {
  return [
    {
      info: { id: "u1", role: "user", providerID: "test-provider", modelID: "test-model" },
      parts: [{ type: "text", text: "please read" }],
    },
    {
      info: { id: "a1", role: "assistant", providerID: "test-provider", modelID: "test-model" },
      parts: toolParts,
    },
  ] as unknown as TestWithParts
}

function findToolResult(modelMsgs: TestModelMsg[], callID: string): string {
  for (const m of modelMsgs) {
    if (m.role !== "tool") continue
    for (const p of m.content ?? []) {
      if (p.type === "tool-result" && p.toolCallId === callID) {
        if (p.output?.type === "text") return p.output.value
        if (p.output?.type === "json") return JSON.stringify(p.output.value)
      }
    }
  }
  throw new Error("tool result not found for " + callID)
}

test("集成：read 工具输出经调用方 fallback 截断到类型上限 2000，且跨轮字节稳定（Bug 1）", async () => {
  resetTruncationDecisions()
  const big = "x".repeat(10_000)
  const input = messages([toolPart("call_1", big, "read")])
  // 第一次序列化（真实生产调用方路径）
  const first = await toModelMessages(input, model, { toolOutputMaxChars: 2_000, toolOutputMaxTotalChars: 24_000 })
  const out1 = findToolResult(first, "call_1")
  expect(out1.length).toBeLessThan(10_000)
  expect(out1).toContain("[Tool output truncated")
  // 第二次序列化同一历史消息：输出必须与第一次逐字节一致（prompt-cache 友好）
  const second = await toModelMessages(input, model, { toolOutputMaxChars: 2_000, toolOutputMaxTotalChars: 24_000 })
  const out2 = findToolResult(second, "call_1")
  expect(out2).toBe(out1)
})

test("集成：聚合预算 maxTotalChars 接线生效，聚合截断优先于类型上限（Bug 2）", async () => {
  resetTruncationDecisions()
  const input = messages([
    toolPart("call_a", "a".repeat(10_000), "read"),
    toolPart("call_b", "b".repeat(10_000), "read"),
    toolPart("call_c", "c".repeat(10_000), "read"),
  ])
  const msgs = await toModelMessages(input, model, { toolOutputMaxChars: 2_000, toolOutputMaxTotalChars: 24_000 })
  const outA = findToolResult(msgs, "call_a")
  const outB = findToolResult(msgs, "call_b")
  const outC = findToolResult(msgs, "call_c")
  // 三条都被截断
  expect(outA).toContain("[Tool output truncated")
  expect(outB).toContain("[Tool output truncated")
  expect(outC).toContain("[Tool output truncated")
  // 聚合把 call_a（最大、升序优先）减到 ~4000，其余回退类型上限 2000 → call_a 更长
  expect(outA.length).toBeGreaterThan(outB.length)
})

test("集成：under 预算小输出不截断", async () => {
  resetTruncationDecisions()
  const input = messages([toolPart("call_1", "small", "read")])
  const msgs = await toModelMessages(input, model, { toolOutputMaxChars: 2_000, toolOutputMaxTotalChars: 24_000 })
  expect(findToolResult(msgs, "call_1")).toBe("small")
})

function userTextMsg(id: string, text: string) {
  return {
    info: { id, role: "user", providerID: "test-provider", modelID: "test-model" },
    parts: [{ type: "text", text }],
  } as unknown as TestWithParts
}

function findUserTexts(modelMsgs: TestModelMsg[]): string[] {
  return modelMsgs
    .filter((m) => m.role === "user")
    .map((m) => {
      if (!Array.isArray(m.content)) return ""
      const texts = m.content
        .filter((p): p is { type: "text"; text: string } => typeof p === "object" && p !== null && "type" in p && (p as { type?: string }).type === "text")
        .map((p) => (p as { text: string }).text)
      return texts.join("\n")
    })
}

test("集成：injectMemories 只注入第一条 user 消息，其余 user 字节不变（前缀固定，CH 99.9%）", async () => {
  const msgs = [
    userTextMsg("u1", "first message"),
    {
      info: { id: "a1", role: "assistant", providerID: "test-provider", modelID: "test-model" },
      parts: [{ type: "text", text: "ok" }],
    },
    userTextMsg("u2", "second message"),
  ]
  const withMem = await toModelMessages(msgs as unknown as TestWithParts, model, { injectMemories: "<memories>fact A</memories>" })
  const texts = findUserTexts(withMem)
  // u1（第一条 user）追加记忆（前缀固定注入）；u2 不含记忆
  expect(texts[0]).toContain("first message")
  expect(texts[0]).toContain("<memories>fact A</memories>")
  expect(texts[1]).toBe("second message")
  // 换一份记忆重新序列化：u2 仍不变；u1 注入随内容变化（记忆会话级固定时也不会变）
  const withMem2 = await toModelMessages(msgs as unknown as TestWithParts, model, { injectMemories: "<memories>fact B</memories>" })
  const texts2 = findUserTexts(withMem2)
  expect(texts2[0]).toContain("fact B")
  expect(texts2[1]).toBe("second message")
  // 不注入 → 无记忆内容
  const noMem = await toModelMessages(msgs as any, model, {})
  expect(findUserTexts(noMem)[0]).toBe("first message")
})

test("集成：maxUserTextChars 截断超大 user 文本（P1-3）", async () => {
  const big = "z".repeat(50_000)
  const out = await toModelMessages([userTextMsg("u1", big)] as any, model, { maxUserTextChars: 24_000 })
  const text = findUserTexts(out)[0]
  expect(text.length).toBeLessThan(50_000)
  expect(text).toContain("[User text truncated")
  // 未设上限 → 不截断
  const full = await toModelMessages([userTextMsg("u1", big)] as any, model, {})
  expect(findUserTexts(full)[0]).toBe(big)
})

test("集成：injectDate 前缀固定模式，只影响第一条 user，其余 user 字节不变（跟进1）", async () => {
  const msgs = [
    userTextMsg("u1", "first"),
    userTextMsg("u2", "second"),
  ]
  const withDate = await toModelMessages(msgs as any, model, { injectDate: "Today's date: 2026-08-13\n" })
  const texts = findUserTexts(withDate)
  expect(texts[0]).toContain("first")
  expect(texts[0]).toContain("Today's date: 2026-08-13")
  expect(texts[1]).toBe("second")
  // 跨天（日期变化）：u1 注入变化（每天一次），u2 仍不变
  const nextDay = await toModelMessages(msgs as any, model, { injectDate: "Today's date: 2026-08-14\n" })
  const texts2 = findUserTexts(nextDay)
  expect(texts2[0]).toContain("2026-08-14")
  expect(texts2[1]).toBe("second")
  // 不注入 → 无日期
  const noDate = await toModelMessages(msgs as any, model, {})
  expect(findUserTexts(noDate)[0]).toBe("first")
})
