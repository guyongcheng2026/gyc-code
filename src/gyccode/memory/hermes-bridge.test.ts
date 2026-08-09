import { expect, test } from "bun:test"
import { formatMemoriesForPrompt, MEMORY_INJECTION_BUDGET } from "./hermes-bridge"
import type { HermesMemoryEntry } from "./hermes-bridge"

const entry = (v: string): HermesMemoryEntry => ({ key: "memory_0", value: v, tags: [] })

test("formatMemoriesForPrompt returns undefined for no entries", () => {
  expect(formatMemoriesForPrompt([])).toBeUndefined()
})

test("formatMemoriesForPrompt formats entries within budget", () => {
  const out = formatMemoriesForPrompt([entry("User prefers TypeScript.")], MEMORY_INJECTION_BUDGET)
  expect(out).toContain("<memories>")
  expect(out).toContain("User prefers TypeScript.")
  expect(out).toContain("</memories>")
})

test("formatMemoriesForPrompt injects freshness reminder for old memory files", () => {
  const out = formatMemoriesForPrompt([entry("The project uses bun.")], MEMORY_INJECTION_BUDGET, 30 * 24 * 60 * 60 * 1000)
  expect(out).toContain("This memory is 30 days old")
  expect(out!.toLowerCase()).toContain("verify against current code")
})

test("formatMemoriesForPrompt omits freshness reminder for fresh memory files", () => {
  const out = formatMemoriesForPrompt([entry("The project uses bun.")], MEMORY_INJECTION_BUDGET, 60 * 60 * 1000)
  expect(out).not.toContain("This memory is")
})


