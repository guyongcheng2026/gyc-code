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
