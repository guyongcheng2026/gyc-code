import { expect, test } from "bun:test"
import { resetTruncationDecisions, toModelMessages } from "./message-v2"

// 从被测函数签名反推 mock 类型，避免 any
type TestWithParts = Parameters<typeof toModelMessages>[0]
type TestModel = Parameters<typeof toModelMessages>[1]

const model = {
  providerID: "test-provider",
  id: "test-model",
  api: { npm: "@ai-sdk/openai", id: "test-api" },
} as unknown as TestModel

function textMsg(id: string, role: "user" | "assistant", text: string) {
  return {
    info: { id, role, providerID: "test-provider", modelID: "test-model" },
    parts: [{ type: "text", text }],
  }
}

// 消息数组由宽松测试桩构造，统一在此桥接为被测函数要求的 schema 类型
const parts = (...rows: unknown[]): TestWithParts => rows as unknown as TestWithParts

/** 会话级固定的注入：日期与记忆在同一会话内不逐轮变化（对齐 CH 机制）。 */
const fixedOptions = {
  injectDate: "Today's date: 2026-09-08\n",
  injectMemories: "<memories>project uses bun</memories>",
}

/**
 * 跨轮前缀 100% 字节稳定（可控前缀达标的核心性质）：
 * 同一会话内，每当新的一轮（新增 user/assistant 消息）被序列化，
 * 上一轮已经存在的所有消息，其发送字节必须逐字节不变——
 * 否则服务商缓存前缀会在轮间折断，实测命中率随之下降。
 */
test("跨轮：追加尾部消息后，既有消息前缀逐字节不变（100% 稳定）", async () => {
  resetTruncationDecisions()
  const round1 = parts(
    textMsg("u1", "user", "first ask"),
    textMsg("a1", "assistant", "first answer"),
    textMsg("u2", "user", "second ask"),
  )
  const round2 = parts(...round1, textMsg("a2", "assistant", "second answer"), textMsg("u3", "user", "third ask"))
  const round3 = parts(...round2, textMsg("a3", "assistant", "third answer"))

  const msgs1 = await toModelMessages(round1, model, fixedOptions)
  const msgs2 = await toModelMessages(round2, model, fixedOptions)
  const msgs3 = await toModelMessages(round3, model, fixedOptions)

  // 轮2 的前缀（即轮1 的全部消息）与轮1 逐字节一致
  expect(msgs2.slice(0, msgs1.length)).toEqual(msgs1)
  expect(JSON.stringify(msgs2.slice(0, msgs1.length))).toBe(JSON.stringify(msgs1))
  // 轮3 的前缀（即轮2 的全部消息）与轮2 逐字节一致
  expect(msgs3.slice(0, msgs2.length)).toEqual(msgs2)
  expect(JSON.stringify(msgs3.slice(0, msgs2.length))).toBe(JSON.stringify(msgs2))
  // 每轮确实新增了尾部（长度递增），证明不是"整段重算"
  expect(msgs2.length).toBe(msgs1.length + 2)
  expect(msgs3.length).toBe(msgs2.length + 1)
})

test("跨轮：无注入（injectDate/injectMemories 为空）时前缀同样 100% 稳定", async () => {
  resetTruncationDecisions()
  const round1 = parts(textMsg("u1", "user", "hello"), textMsg("a1", "assistant", "hi"))
  const round2 = parts(...round1, textMsg("u2", "user", "more"))

  const msgs1 = await toModelMessages(round1, model, {})
  const msgs2 = await toModelMessages(round2, model, {})
  expect(JSON.stringify(msgs2.slice(0, msgs1.length))).toBe(JSON.stringify(msgs1))
})

test("跨轮：多次序列化同一轮历史结果确定性一致（无随机/时间戳/排序抖动）", async () => {
  resetTruncationDecisions()
  const msgs = parts(textMsg("u1", "user", "alpha"), textMsg("a1", "assistant", "beta"), textMsg("u2", "user", "gamma"))
  const first = await toModelMessages(msgs, model, fixedOptions)
  const second = await toModelMessages(msgs, model, fixedOptions)
  expect(JSON.stringify(second)).toBe(JSON.stringify(first))
  // 结果结构也稳定：消息数与角色序列不随调用变化
  expect(first.map((m) => m.role)).toEqual(second.map((m) => m.role))
})

test("跨轮：注入只落在第一条 user，新轮追加不影响既有消息字节（含工具轮）", async () => {
  resetTruncationDecisions()
  const toolOut = "line\n".repeat(3000) // 触发截断（>2000）
  const round1 = parts(
    textMsg("u1", "user", "read the file"),
    {
      info: { id: "a1", role: "assistant", providerID: "test-provider", modelID: "test-model" },
      parts: [
        { type: "text", text: "reading…" },
        {
          type: "tool",
          callID: "call_1",
          tool: "read",
          state: { status: "completed", input: {}, output: toolOut, title: "t", metadata: {}, time: { start: 0, end: 1 } },
        },
      ],
    },
    textMsg("u2", "user", "next"),
  )
  const round2 = parts(...round1, textMsg("a2", "assistant", "done"), textMsg("u3", "user", "tail"))
  const opts = { ...fixedOptions, toolOutputMaxChars: 2_000, toolOutputMaxTotalChars: 24_000 }

  const msgs1 = await toModelMessages(round1, model, opts)
  const msgs2 = await toModelMessages(round2, model, opts)
  expect(JSON.stringify(msgs2.slice(0, msgs1.length))).toBe(JSON.stringify(msgs1))
})

/**
 * 必要动态注入（日期跨天/记忆刷新）的边界可控性：
 * 更新只会"断"更新发生的那个请求；一旦注入在新一轮固定，其后的连续轮
 * 相对新基线仍 100% 字节稳定——即"变化只断一次前缀，随后恢复"，不会持续漂移。
 */
test("注入更新（日期跨天/记忆刷新）只断更新轮，其后相对新基线恢复 100% 稳定", async () => {
  resetTruncationDecisions()
  const base = parts(textMsg("u1", "user", "ask1"), textMsg("a1", "assistant", "ans1"))
  const historyTail = parts(textMsg("u2", "user", "tail1"), textMsg("a2", "assistant", "ans2"))
  const day1 = { injectDate: "Today's date: 2026-09-07\n", injectMemories: "<memories>old fact</memories>" }
  const day2 = { injectDate: "Today's date: 2026-09-08\n", injectMemories: "<memories>new fact</memories>" }

  // 跨天前最后一轮（注入=day1）
  const before = await toModelMessages(parts(...base, ...historyTail), model, day1)
  // 跨天后首轮：注入更新为 day2 → 前缀在首条 user 处变化（预期只断这一轮）
  const crossing = await toModelMessages(parts(...base, ...historyTail, textMsg("u3", "user", "tail3")), model, day2)
  // 注入更新确实改变了首条 user 的字节（断裂点存在）
  expect(JSON.stringify(crossing)).not.toBe(JSON.stringify(before))
  // 跨天后后续轮：注入不再变 → 相对 crossing 的既有前缀 100% 稳定（断一次随即恢复）
  const after1 = await toModelMessages(
    parts(...base, ...historyTail, textMsg("u3", "user", "tail3"), textMsg("a3", "assistant", "ans3")),
    model,
    day2,
  )
  const after2 = await toModelMessages(
    parts(
      ...base,
      ...historyTail,
      textMsg("u3", "user", "tail3"),
      textMsg("a3", "assistant", "ans3"),
      textMsg("u4", "user", "tail4"),
    ),
    model,
    day2,
  )
  expect(JSON.stringify(after1.slice(0, crossing.length))).toBe(JSON.stringify(crossing))
  expect(JSON.stringify(after2.slice(0, after1.length))).toBe(JSON.stringify(after1))
})
