import { Effect } from "effect"
import type { HermesMemoryEntry } from "./hermes-bridge"
import { deduplicateMemories } from "./extract"

export interface ExtractionConfig {
  minTurns: number
  model: string
  maxMemories: number
}

export interface ExtractionInput {
  readonly conversation: string
  readonly existing: readonly HermesMemoryEntry[]
  readonly config: ExtractionConfig
}

/** Injected: turns a conversation into candidate memory lines (LLM call). */
export type Extractor = (input: ExtractionInput) => Effect.Effect<string[]>

/** Injected: persists new memories to durable storage. */
export type MemorySink = (memories: readonly string[]) => Effect.Effect<number>

export interface RunOptions {
  readonly extractor: Extractor
  readonly sink: MemorySink
  readonly existing: readonly HermesMemoryEntry[]
  readonly conversation: string
  readonly config: ExtractionConfig
}

/**
 * Run one memory-extraction step: ask the extractor for candidate memories,
 * filter out ones already present (case-insensitive substring), cap to
 * maxMemories, then persist. Pure wrapper — all I/O is injected.
 */
export function runExtraction(options: RunOptions): Effect.Effect<string[]> {
  return Effect.gen(function* () {
    const candidates = yield* options.extractor({
      conversation: options.conversation,
      existing: options.existing,
      config: options.config,
    })
    const fresh = candidates.filter((candidate) => deduplicateMemories(options.existing, candidate))
    const capped = fresh.slice(0, options.config.maxMemories)
    if (capped.length > 0) {
      yield* options.sink(capped)
    }
    return capped
  })
}

/** Default sink: persist into the hermes memory file. */
export const hermesMemorySink: MemorySink = (memories) =>
  Effect.promise(async () => {
    const { writeHermesMemoryFile } = await import("./hermes-bridge")
    let count = 0
    for (const content of memories) {
      await writeHermesMemoryFile({ key: `extract_${Date.now()}_${count}`, value: content + "\n" }, true)
      count++
    }
    return count
  })
