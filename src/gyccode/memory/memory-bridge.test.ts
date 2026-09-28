import { afterAll, beforeAll, describe, expect, test } from "bun:test"
import { mkdtemp, rm } from "fs/promises"
import { tmpdir } from "os"
import path from "path"
import { formatMemoriesForPrompt, MEMORY_INJECTION_BUDGET, readMemories, searchMemories, writeMemoryFile } from "./memory-bridge"
import type { MemoryEntry } from "./memory-bridge"

const entry = (v: string): MemoryEntry => ({ key: "memory_0", value: v, tags: [] })

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

describe("memory file SEP round-trip and searchMemories", () => {
  const prevHome = process.env.GYCCODE_MEMORY_HOME
  let home = ""

  beforeAll(async () => {
    home = await mkdtemp(path.join(tmpdir(), "gyc-mem-"))
    process.env.GYCCODE_MEMORY_HOME = home
  })

  afterAll(async () => {
    if (prevHome === undefined) delete process.env.GYCCODE_MEMORY_HOME
    else process.env.GYCCODE_MEMORY_HOME = prevHome
    await rm(home, { recursive: true, force: true })
  })

  test("readMemories splits entries on SEP（GBK § 损坏回归守护）", async () => {
    await writeMemoryFile({ key: "a", value: "prefers TypeScript for all new code" }, false)
    await writeMemoryFile({ key: "b", value: "runs everything with bun runtime" })
    const entries = await readMemories()
    expect(entries).toHaveLength(2)
    expect(entries[0]!.key).toBe("a")
    expect(entries[1]!.key).toBe("b")
    expect(entries[1]!.value).toContain("bun runtime")
  })

  test("writeMemoryFile skips exact duplicates", async () => {
    await writeMemoryFile({ key: "dup", value: "prefers TypeScript for all new code" })
    const entries = await readMemories()
    expect(entries).toHaveLength(2)
  })

  test("searchMemories returns [] for empty query", async () => {
    expect(await searchMemories("")).toEqual([])
    expect(await searchMemories("   ")).toEqual([])
  })

  test("searchMemories matches by keyword and ranks matches", async () => {
    const hits = await searchMemories("typescript")
    expect(hits.length).toBeGreaterThanOrEqual(1)
    expect(hits[0]!.value).toContain("TypeScript")
    expect(hits.every((h) => (h.key + h.value).toLowerCase().includes("typescript"))).toBe(true)
  })

  test("searchMemories respects the limit", async () => {
    const hits = await searchMemories("TypeScript bun", 1)
    expect(hits).toHaveLength(1)
  })

  test("searchMemories returns [] when nothing matches", async () => {
    expect(await searchMemories("qqqzzznomatch")).toEqual([])
  })
})


