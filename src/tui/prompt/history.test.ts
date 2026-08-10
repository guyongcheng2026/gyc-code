import { describe, expect, it } from "bun:test"
import { MAX_HISTORY_ENTRIES, dedupeHistory, parsePromptHistory } from "./history"

const entry = (input: string) => ({ input, parts: [] })

describe("dedupeHistory", () => {
  it("merges records with identical content into one, keeping the most recent occurrence", () => {
    const merged = dedupeHistory([entry("a"), entry("b"), entry("a"), entry("c")])
    expect(merged.map((e) => e.input)).toEqual(["b", "a", "c"])
  })

  it("merges consecutive duplicates too", () => {
    const merged = dedupeHistory([entry("a"), entry("a"), entry("b")])
    expect(merged.map((e) => e.input)).toEqual(["a", "b"])
  })

  it("preserves order for unique records", () => {
    const merged = dedupeHistory([entry("a"), entry("b"), entry("c")])
    expect(merged.map((e) => e.input)).toEqual(["a", "b", "c"])
  })
})

describe("parsePromptHistory", () => {
  it("merges records with identical content read from the file", () => {
    const text = [entry("a"), entry("b"), entry("a")].map((e) => JSON.stringify(e)).join("\n") + "\n"
    expect(parsePromptHistory(text).map((e) => e.input)).toEqual(["b", "a"])
  })

  it("drops invalid lines", () => {
    const text = `not json\n${JSON.stringify(entry("a"))}\n`
    expect(parsePromptHistory(text).map((e) => e.input)).toEqual(["a"])
  })

  it("caps retained entries at MAX_HISTORY_ENTRIES", () => {
    const entries = Array.from({ length: MAX_HISTORY_ENTRIES + 5 }, (_, i) => entry(`e${i}`))
    const text = entries.map((e) => JSON.stringify(e)).join("\n") + "\n"
    expect(parsePromptHistory(text)).toHaveLength(MAX_HISTORY_ENTRIES)
  })
})