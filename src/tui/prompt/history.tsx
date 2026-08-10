import path from "path"
import { onMount } from "solid-js"
import { createStore, produce, unwrap } from "solid-js/store"
import type { AgentPart, FilePart, TextPart } from "@opencode-ai/sdk/v2"
import { createSimpleContext } from "../context/helper"
import { useTuiPaths } from "../context/runtime"
import { appendText, readText, writeText } from "../util/persistence"

export type PromptInfo = {
  input: string
  mode?: "normal" | "shell"
  parts: (
    | Omit<FilePart, "id" | "messageID" | "sessionID">
    | Omit<AgentPart, "id" | "messageID" | "sessionID">
    | (Omit<TextPart, "id" | "messageID" | "sessionID"> & {
        source?: {
          text: {
            start: number
            end: number
            value: string
          }
        }
      })
  )[]
}

export const MAX_HISTORY_ENTRIES = 50

/** Merge entries with identical content (same `input`) into one, keeping the most recent occurrence. */
export function dedupeHistory(entries: PromptInfo[]): PromptInfo[] {
  const seen = new Set<string>()
  const merged: PromptInfo[] = []
  for (let i = entries.length - 1; i >= 0; i--) {
    const entry = entries[i]
    if (seen.has(entry.input)) continue
    seen.add(entry.input)
    merged.push(entry)
  }
  return merged.reverse()
}

export function parsePromptHistory(text: string) {
  return dedupeHistory(
    text
      .split("\n")
      .filter(Boolean)
      .map((line) => {
        try {
          return JSON.parse(line) as PromptInfo
        } catch {
          return undefined
        }
      })
      .filter((line): line is PromptInfo => line !== undefined),
  ).slice(-MAX_HISTORY_ENTRIES)
}

export const { use: usePromptHistory, provider: PromptHistoryProvider } = createSimpleContext({
  name: "PromptHistory",
  init: () => {
    const paths = useTuiPaths()
    const historyPath = path.join(paths.state, "prompt-history.jsonl")
    onMount(async () => {
      const lines = parsePromptHistory(await readText(historyPath).catch(() => ""))
      setStore("history", lines)

      // Rewrite valid retained entries to self-heal corruption and enforce the limit.
      if (lines.length > 0)
        writeText(historyPath, lines.map((line) => JSON.stringify(line)).join("\n") + "\n").catch(() => {})
    })

    const [store, setStore] = createStore({
      index: 0,
      history: [] as PromptInfo[],
    })

    return {
      /** All retained history entries (already deduped by `input`, oldest first). */
      list() {
        return store.history
      },
      move(direction: 1 | -1, input: string) {
        if (!store.history.length) return undefined
        const current = store.history.at(store.index)
        if (!current) return undefined
        if (current.input !== input && input.length) return
        setStore(
          produce((draft) => {
            const next = store.index + direction
            if (Math.abs(next) > store.history.length) return
            if (next > 0) return
            draft.index = next
          }),
        )
        if (store.index === 0) return { input: "", parts: [] }
        return store.history.at(store.index)
      },
      suggest(query: string): PromptInfo[] {
        const q = query.trim().toLowerCase()
        if (!q) return []
        return [...store.history]
          .filter((h) => h.input && h.input.toLowerCase().startsWith(q) && h.input.length > q.length)
          .slice(-8)
          .reverse()
      },
      append(item: PromptInfo) {
        const entry = structuredClone(unwrap(item))
        if (store.history.at(-1)?.input === entry.input) {
          setStore("index", 0)
          return
        }
        let rewrite = false
        setStore(
          produce((draft) => {
            const next = dedupeHistory([...draft.history, entry])
            rewrite = next.length < draft.history.length + 1 || next.length > MAX_HISTORY_ENTRIES
            draft.history = next.slice(-MAX_HISTORY_ENTRIES)
            draft.index = 0
          }),
        )

        if (rewrite) {
          writeText(historyPath, store.history.map((line) => JSON.stringify(line)).join("\n") + "\n").catch(() => {})
          return
        }
        appendText(historyPath, JSON.stringify(entry) + "\n").catch(() => {})
      },
      /** Remove a history entry by index (oldest-first ordering). Rewrites the backing file. */
      remove(index: number) {
        if (index < 0 || index >= store.history.length) return
        setStore(
          produce((draft) => {
            draft.history.splice(index, 1)
          }),
        )
        writeText(
          historyPath,
          store.history.length > 0 ? store.history.map((line) => JSON.stringify(line)).join("\n") + "\n" : "",
        ).catch(() => {})
      },
    }
  },
})
