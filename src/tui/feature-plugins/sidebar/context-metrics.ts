import type { AssistantMessage, Message, Part } from "@gyccode/protocol/v2"
import { Token } from "@/util/token"

export function estimatePart(part: Part): number {
  if (part.type === "text" || part.type === "reasoning") return Token.estimate(part.text)
  if (part.type === "tool") {
    return Math.max(1, Math.ceil(JSON.stringify({ tool: part.tool, state: part.state }).length / 4))
  }
  return 0
}

// Only in-flight messages need estimation; completed assistant messages have
// exact persisted token counts. Estimating is far more expensive than reading
// the four persisted integers, so prefer the latter on the hot path.
export function estimateMessage(message: Message, partOf: (id: string) => ReadonlyArray<Part>): number {
  if (message.role === "assistant" && message.time.completed) {
    return (
      message.tokens.input +
      message.tokens.output +
      message.tokens.reasoning +
      message.tokens.cache.read +
      message.tokens.cache.write
    )
  }
  return partOf(message.id).reduce((sum, part) => sum + estimatePart(part), 0)
}

// Sum the persisted token counters across all messages — O(1) per message,
// no tokenization. Used for completed sessions and idle context windows.
export function persistedTokens(msgs: ReadonlyArray<Message>): number {
  let total = 0
  for (const message of msgs) {
    if (message.role === "assistant" && message.time.completed) {
      total +=
        message.tokens.input +
        message.tokens.output +
        message.tokens.reasoning +
        message.tokens.cache.read +
        message.tokens.cache.write
    }
  }
  return total
}

/**
 * Prompt-cache hit rate (CH): cache.read tokens / full input tokens across
 * completed assistant messages (first-turn cold miss excluded — industry
 * convention). DeepSeek context caching is 128-token-block aligned with a
 * lagging anchor, so the theoretical steady-state ceiling is ≈ 1 - 2/N
 * (N = completed assistant turns, mirrors reference agent's cache model). A CH far
 * below that ceiling indicates prefix drift, not cold start.
 */
export function computeChRate(
  msgs: ReadonlyArray<Message>,
): { actual: number; theory: number } | null {
  let read = 0
  let total = 0
  let completed = 0
  for (const m of msgs) {
    if (m.role !== "assistant" || m.time.completed === undefined) continue
    completed++
    read += m.tokens.cache.read
    // Full input tokens = net input + cache read + cache write (session.ts
    // persists `input` as the non-cached remainder, so rebuild the inclusive
    // input to get the true cache-hit denominator).
    total += m.tokens.input + m.tokens.cache.read + m.tokens.cache.write
  }
  if (completed < 2 || total <= 0) return null
  const actual = (read / total) * 100
  const theory = Math.max(0, (1 - 2 / completed) * 100)
  return { actual, theory }
}

/** True when the last assistant message has any real token usage (not just output). */
export function hasTokenUsage(m: AssistantMessage): boolean {
  return m.tokens.input + m.tokens.output + m.tokens.reasoning + m.tokens.cache.read > 0
}
