import { expect, test } from "bun:test"
import { resetTruncationDecisions, toModelMessages } from "./message-v2"

const model = {
  providerID: "test-provider",
  id: "test-model",
  api: { npm: "@ai-sdk/openai", id: "test-api" },
} as any

function toolPart(callID: string, output: string, tool: string = "read") {
  return {
    type: "tool",
    callID,
    tool,
    state: { status: "completed", input: {}, output, title: "t", metadata: {}, time: { start: 0, end: 1 } },
  } as any
}

function messages(toolParts: any[]) {
  return [
    {
      info: { id: "u1", role: "user", providerID: "test-provider", modelID: "test-model" },
      parts: [{ type: "text", text: "please read" }],
    },
    {
      info: { id: "a1", role: "assistant", providerID: "test-provider", modelID: "test-model" },
      parts: toolParts,
    },
  ] as any
}

function findToolResult(modelMsgs: any[], callID: string): string {
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
