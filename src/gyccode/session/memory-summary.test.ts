import { expect, test } from "bun:test"
import { buildMemorySummary, cleanMemoryValue } from "./compaction"
import type { MemoryEntry } from "../memory/memory-bridge"

function entry(value: string, key = "k"): MemoryEntry {
  return { key, value }
}

test("cleanMemoryValue strips #memory_ prefix line", () => {
  expect(cleanMemoryValue("#memory_abc\nactual content")).toBe("actual content")
})

test("cleanMemoryValue keeps content without prefix", () => {
  expect(cleanMemoryValue("plain content")).toBe("plain content")
})

test("cleanMemoryValue trims whitespace", () => {
  expect(cleanMemoryValue("  spaced  ")).toBe("spaced")
})

test("buildMemorySummary returns undefined for empty memories", () => {
  expect(buildMemorySummary([])).toBeUndefined()
})

test("buildMemorySummary returns undefined when all values are empty", () => {
  expect(buildMemorySummary([entry(""), entry("  ")])).toBeUndefined()
})

test("buildMemorySummary wraps memories in summary tags", () => {
  const result = buildMemorySummary([entry("fact one"), entry("fact two")])
  expect(result).toContain("<summary>")
  expect(result).toContain("</summary>")
  expect(result).toContain("- fact one")
  expect(result).toContain("- fact two")
})

test("buildMemorySummary includes previous summary when provided", () => {
  const result = buildMemorySummary([entry("new fact")], "old context")
  expect(result).toContain("Previous context:")
  expect(result).toContain("old context")
  expect(result).toContain("- new fact")
})

test("buildMemorySummary omits previous context when absent", () => {
  const result = buildMemorySummary([entry("fact")])
  expect(result).not.toContain("Previous context")
})

test("buildMemorySummary strips #memory_ prefixes from entries", () => {
  const result = buildMemorySummary([entry("#memory_x\nreal fact")])
  expect(result).toContain("- real fact")
  expect(result).not.toContain("#memory_x")
})

const countPrevious = (value: string) => value.split("Previous context:").length - 1

test("buildMemorySummary 不把旧摘要里已有的 Previous context 再次套娃", () => {
  const nested = "Previous context:\nPrevious context:\nKey facts and decisions captured so far:\n- old fact"
  const result = buildMemorySummary([entry("new fact")], nested)!
  expect(countPrevious(result)).toBe(1)
  // 被掐断的嵌套内容不能丢：取最内层，记忆条目仍需保留
  expect(result).toContain("old fact")
  expect(result).toContain("- new fact")
})

test("buildMemorySummary 连续多轮压缩后 Previous context 不会层层叠加", () => {
  let previous: string | undefined
  for (let i = 0; i < 5; i++) previous = buildMemorySummary([entry(`fact ${i}`)], previous)
  expect(countPrevious(previous!)).toBe(1)
})
