import { describe, expect, test } from "bun:test"
import { pivotTail } from "./compaction"
import type { MessageID } from "./schema"

// 从被测函数签名反推 mock 消息类型，避免 any
type PivotMsg = Parameters<typeof pivotTail>[0][number]

function mid(id: string) {
  return id as MessageID
}

function msg(id: string, role: "user" | "assistant"): PivotMsg {
  return { info: { id, role }, parts: [] } as unknown as PivotMsg
}

test("pivotTail splits head before pivot and tail_start_id at pivot", () => {
  const msgs = [msg("m0", "user"), msg("m1", "assistant"), msg("m2", "user"), msg("m3", "assistant")]
  const result = pivotTail(msgs, mid("m2"))
  expect(result).toBeDefined()
  expect(result!.head.map((m) => m.info.id as string)).toEqual(["m0", "m1"])
  expect(result!.tail_start_id as string).toBe("m2")
})

test("pivotTail returns undefined when pivot is the first message", () => {
  const msgs = [msg("m0", "user"), msg("m1", "assistant")]
  expect(pivotTail(msgs, mid("m0"))).toBeUndefined()
})

test("pivotTail returns undefined when pivot does not exist", () => {
  const msgs = [msg("m0", "user"), msg("m1", "assistant")]
  expect(pivotTail(msgs, mid("nope"))).toBeUndefined()
})
