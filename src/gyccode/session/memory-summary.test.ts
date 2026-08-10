import { expect, test } from "bun:test"
import { buildMemorySummary, cleanMemoryValue } from "./compaction"
import type { HermesMemoryEntry } from "../memory/hermes-bridge"

function entry(value: string, key = "k"): HermesMemoryEntry {
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
