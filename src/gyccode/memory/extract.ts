import { Effect } from "effect"
import { writeMemoryFile, type MemoryEntry } from "./memory-bridge"
import { detectHallucinationMarkers } from "./dream"

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
  // minTurns 允许为 0（Schema.optional(NonNegativeInt)），但 `n % 0` 是 NaN，
  // `NaN === 0` 恒 false 会让抽取永久失效；0 的语义是"每轮都抽"，故下限取 1
  const period = config.minTurns > 0 ? config.minTurns : 1
  return turnCount >= period && turnCount % period === 0
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

/**
 * 2026-09-30（幻觉率 P2 / H-07）：幻觉检测此前只跑在 dream 自己合成的摘要上，
 * 而摘要的原料是对话内容——也就是说模型编造的事实会经提取流程原样写进记忆，
 * 下一轮又被当作事实读回。改为在提取出口把关：带幻觉措辞的条目不入记忆。
 *
 * 判定复用 dream 的同一份模式（已剔除 `/maybe/i`、`/possibly/i` 这类会误伤
 * 技术表述的裸词），因此「Possibly a caching layer」这类正常归纳不会被丢弃。
 */
export function partitionByHallucination(
  memories: readonly string[],
): { readonly kept: string[]; readonly dropped: ReadonlyArray<{ content: string; markers: string[] }> } {
  const kept: string[] = []
  const dropped: Array<{ content: string; markers: string[] }> = []
  for (const content of memories) {
    const markers = detectHallucinationMarkers(content)
    if (markers.length > 0) dropped.push({ content, markers })
    else kept.push(content)
  }
  return { kept, dropped }
}

export function persistExtractedMemories(
  memories: readonly string[],
): Effect.Effect<number, never> {
  return Effect.gen(function* () {
    // H-07：出口把关——带幻觉措辞的条目不入记忆（见 partitionByHallucination）
    const { kept, dropped } = partitionByHallucination(memories)
    if (dropped.length > 0) {
      yield* Effect.logWarning("discarded hallucinated memory candidates", {
        count: dropped.length,
        markers: Array.from(new Set(dropped.flatMap((item) => item.markers))),
      }).pipe(Effect.orDie)
    }
    let count = 0
    for (const content of kept) {
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
