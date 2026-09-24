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
 * Prompt-cache hit rate (CH), two complementary 口径:
 * - `actual` = cache.read / inclusive input（含每轮新增内容——新增本就不可命中，
 *   该口径结构性 <100%，大输出轮会被拉低，不适合做健康度门槛）。
 * - `prefix` = 前缀命中率（稳态）：本轮 min(cache.read, 上一轮 inclusive input) /
 *   上一轮 inclusive input——只衡量「对已有前缀是否命中」，新增与冷启动不计入；
 *   单轮骤降 >10% 的漂移事件轮同样剔除（字节变更折断是事件不是稳态失稳）。
 *   稳态受 DeepSeek 128 块对齐滞后锚影响约 −0.2%，健康线 ≥99.5%。
 * `theory` = 1 − 2/N（N=completed turns，块对齐滞后锚的 actual 理论天花板）。
 * 首条 assistant 无上一轮可比、不进 prefix 分母。
 */
export function computeChRate(
  msgs: ReadonlyArray<Message>,
): { actual: number; theory: number; prefix: number } | null {
  let read = 0
  let total = 0
  let completed = 0
  let prevTotal = 0
  let prefixHit = 0
  let prefixBase = 0
  for (const m of msgs) {
    if (m.role !== "assistant" || m.time.completed === undefined) continue
    const inclusive = m.tokens.input + m.tokens.cache.read + m.tokens.cache.write
    if (completed > 0) {
      // 单轮前缀骤降 >10%（read < 0.9×上一轮）＝漂移事件轮（记忆/指令/工具字节
      // 变更后的首轮折断，如工具描述改动），非缓存机制失稳——不进稳态分母，
      // 事件本身由 db cache 逐条标注归因。
      const healthy = m.tokens.cache.read >= prevTotal * 0.9
      if (healthy) {
        prefixHit += Math.min(m.tokens.cache.read, prevTotal)
        prefixBase += prevTotal
      }
    }
    completed++
    read += m.tokens.cache.read
    total += inclusive
    prevTotal = inclusive
  }
  if (completed < 2 || total <= 0) return null
  const actual = (read / total) * 100
  const theory = Math.max(0, (1 - 2 / completed) * 100)
  const prefix = prefixBase > 0 ? (prefixHit / prefixBase) * 100 : 0
  return { actual, theory, prefix }
}

/** True when the last assistant message has any real token usage (not just output). */
export function hasTokenUsage(m: AssistantMessage): boolean {
  return m.tokens.input + m.tokens.output + m.tokens.reasoning + m.tokens.cache.read > 0
}
