import { Effect } from "effect"
import { readMemories, writeMemoryFile, type MemoryEntry } from "./memory-bridge"

export interface ExtractionConfig {
  /** Minimum turns before triggering extraction */
  minTurns: number
  /** Model to use for extraction (cheap/fast) */
  model: string
  /** Maximum memories to extract per run */
  maxMemories: number
}

export const DEFAULT_EXTRACTION_CONFIG: ExtractionConfig = {
  minTurns: 3,
  model: "deepseek/deepseek-chat",
  maxMemories: 5,
}

export function shouldExtract(turnCount: number, config: ExtractionConfig = DEFAULT_EXTRACTION_CONFIG): boolean {
  return turnCount >= config.minTurns && turnCount % config.minTurns === 0
}

export function deduplicateMemories(
  existing: readonly MemoryEntry[],
  candidate: string,
): boolean {
  const normalized = candidate.toLowerCase().trim()
  return !existing.some(
    (entry) => entry.value.toLowerCase().trim().includes(normalized) ||
               normalized.includes(entry.value.toLowerCase().trim())
  )
}

export function formatExtractionPrompt(recentConversation: string, existingMemories: readonly MemoryEntry[]): string {
  const existingText = existingMemories.length > 0
    ? `\nExisting memories:\n${existingMemories.map((m, i) => `${i + 1}. ${m.value}`).join("\n")}`
    : ""

  return `Extract key facts, decisions, and learnings from this conversation. Return ONLY new information not already in existing memories. Format each memory as a single sentence on its own line. Maximum 5 memories.

Recent conversation:
${recentConversation}
${existingText}

New memories (one per line, or "NONE" if nothing new):`
}

export function parseExtractionResult(raw: string): string[] {
  return raw
    .split("\n")
    .map(line => line.replace(/^\d+[\.\)]\s*/, "").trim())
    .filter(line => line.length > 10 && line !== "NONE" && !line.startsWith("New memories"))
}

export function persistExtractedMemories(
  memories: readonly string[],
): Effect.Effect<number, never> {
  return Effect.gen(function* () {
    let count = 0
    for (const content of memories) {
      yield* Effect.promise(() =>
        writeMemoryFile({
          key: `extract_${Date.now()}_${count}`,
          value: content + "\n",
        }, true)
      )
      count++
    }
    return count
  })
}
