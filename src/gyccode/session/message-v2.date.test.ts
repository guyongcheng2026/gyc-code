import { expect, test } from "bun:test"
import type { ModelMessage } from "ai"
import { prependTodayDate } from "./message-v2"

test("prependTodayDate prepends date text to the last user message content array", () => {
  const msgs: ModelMessage[] = [
    { role: "user", content: [{ type: "text", text: "first" }] },
    { role: "assistant", content: "ok" },
    { role: "user", content: [{ type: "text", text: "latest" }] },
  ]
  const out = prependTodayDate(msgs, "Today's date: X\n")
  expect(out).not.toBe(msgs)
  expect(out[2].content).toEqual([
    { type: "text", text: "Today's date: X\n" },
    { type: "text", text: "latest" },
  ])
})

test("prependTodayDate converts string content to a text array", () => {
  const msgs: ModelMessage[] = [{ role: "user", content: "hello" }]
  const out = prependTodayDate(msgs, "D\n")
  expect(out[0].content).toEqual([{ type: "text", text: "D\n" }, { type: "text", text: "hello" }])
})

test("prependTodayDate leaves non-user conversations untouched", () => {
  const msgs: ModelMessage[] = [{ role: "assistant", content: "ok" }]
  const out = prependTodayDate(msgs, "D\n")
  expect(out).toEqual(msgs)
})
