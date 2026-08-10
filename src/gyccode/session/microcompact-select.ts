import type { SessionV1 } from "@gyccode/core/v1/session"

/**
 * Micro-compaction selection: when context usage reaches a high-water mark
 * (before full compaction), clear the outputs of middle tool calls — keeping
 * the prompt-cache prefix and the most recent turns intact — so the model keeps
 * seeing the tail verbatim while freed space delays a full summary compaction.
 *
 * Aligned with Claude Code's microCompact: it clears tool results (Read/Shell/
 * Grep/Glob/WebSearch/WebFetch/Edit/Write) without dropping messages, and never
 * touches skill outputs (they carry instructions the model still needs).
 */

export const MICROCOMPACT_THRESHOLD = 0.85
export const CACHE_PREFIX_KEEP = 10
const TAIL_KEEP = 5
const PROTECTED_TOOLS = new Set(["skill"])

export interface WithParts {
  info: { role: string; id: string }
  parts: readonly SessionV1.Part[]
}

/**
 * Select tool parts whose outputs should be cleared via micro-compaction.
 * Returns an empty list when usage is below the threshold. The cache prefix
 * (first CACHE_PREFIX_KEEP messages), the last TAIL_KEEP messages, and any
 * skill tool output are always preserved.
 */
export function selectMicrocompactParts(
  msgs: readonly WithParts[],
  contextUsed: number,
  contextLimit: number,
): Array<SessionV1.ToolPart & { _msgIndex: number }> {
  const ratio = contextUsed / contextLimit
  if (ratio < MICROCOMPACT_THRESHOLD) return []
  if (msgs.length <= CACHE_PREFIX_KEEP + TAIL_KEEP) return []

  const selected: Array<SessionV1.ToolPart & { _msgIndex: number }> = []
  for (let i = CACHE_PREFIX_KEEP; i < msgs.length - TAIL_KEEP; i++) {
    const msg = msgs[i]
    for (const part of msg.parts) {
      if (part.type !== "tool") continue
      if (part.state.status !== "completed") continue
      if (part.state.time.compacted) continue
      if (PROTECTED_TOOLS.has(part.tool)) continue
      selected.push({ ...part, _msgIndex: i })
    }
  }
  return selected
}

/**
 * Time-based micro-compaction: when the gap since the last main-loop assistant
 * message exceeds `gapMinutes`, the server-side prompt cache has almost
 * certainly expired, so the full prefix will be rewritten anyway. Clearing old
 * tool results before the request shrinks what gets rewritten.
 * (Aligned with Claude Code timeBasedMCConfig, but locally configurable.)
 */
export function selectTimeBasedParts(
  msgs: readonly WithParts[],
  opts: { now?: number; gapMinutes: number; keepRecent: number },
): Array<SessionV1.ToolPart & { _msgIndex: number }> {
  const now = opts.now ?? Date.now()
  const gapMs = opts.gapMinutes * 60 * 1000
  let lastAt = 0
  for (const msg of msgs) {
    if (msg.info.role !== "assistant") continue
    for (const part of msg.parts) {
      if (part.type === "tool" && part.state.status === "completed" && part.state.time.end) {
        lastAt = Math.max(lastAt, part.state.time.end)
      }
    }
  }
  if (lastAt === 0 || now - lastAt < gapMs) return []
  if (msgs.length <= opts.keepRecent) return []

  // With fewer messages than the cache prefix plus the recent tail, protecting
  // the prefix would leave nothing to compact. The cache is expired anyway, so
  // clear everything except the keepRecent tail.
  const start = msgs.length > CACHE_PREFIX_KEEP + opts.keepRecent ? CACHE_PREFIX_KEEP : 0

  const selected: Array<SessionV1.ToolPart & { _msgIndex: number }> = []
  for (let i = start; i < msgs.length - opts.keepRecent; i++) {
    const msg = msgs[i]
    for (const part of msg.parts) {
      if (part.type !== "tool") continue
      if (part.state.status !== "completed") continue
      if (part.state.time.compacted) continue
      if (PROTECTED_TOOLS.has(part.tool)) continue
      selected.push({ ...part, _msgIndex: i })
    }
  }
  return selected
}

/**
 * Whether `microcompactIfNeeded` should tell the caller to continue the loop
 * (i.e. it did real work that reduced the overflow) or let the caller escalate
 * to full compaction.
 *
 * - Anything cleared (time-based or usage-based) -> true: overflow was reduced,
 *   the caller re-checks and continues.
 * - Nothing cleared and no usable limit -> false: cannot micro-compact.
 * - Nothing cleared but a valid limit with nothing selectable -> false: escalate
 *   to full compaction so the fallback stays reachable (no busy-loop).
 */
export function shouldContinueAfterMicrocompact(clearedAny: boolean, limitOk: boolean, selectedAny: boolean): boolean {
  if (clearedAny) return true
  if (!limitOk) return false
  return selectedAny
}
