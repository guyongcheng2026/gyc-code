/**
 * API-native context management (Anthropic `context-management` beta).
 * Lets the API clear old thinking blocks / tool uses server-side, shrinking
 * the request without a client-side compaction round. Aligned with Claude
 * Code's apiMicrocompact, but universally configurable (Claude gates tool
 * clearing behind ant-only env flags).
 */

export const CONTEXT_MANAGEMENT_BETA_HEADER = "context-management-2025-06-27"

export interface ContextManagementConfig {
  enabled: boolean
  trigger_threshold?: number
  keep_target?: number
  clear_thinking?: boolean
  clear_tool_uses?: boolean
  thinking_turns?: number
}

export type ContextManagementEdit =
  | { type: "clear_thinking_20251015"; keep: { type: "thinking_turns"; value: number } }
  | {
      type: "clear_tool_uses_20250919"
      trigger: { type: "token_threshold"; value: number }
      clear_at_least: { type: "token_count"; value: number }
      exclude_tools: string[]
    }

export function contextManagementEdits(cfg: ContextManagementConfig): ContextManagementEdit[] | undefined {
  if (!cfg.enabled) return undefined
  const edits: ContextManagementEdit[] = []
  if (cfg.clear_thinking === true) {
    edits.push({ type: "clear_thinking_20251015", keep: { type: "thinking_turns", value: cfg.thinking_turns ?? 1 } })
  }
  if (cfg.clear_tool_uses === true) {
    const trigger = cfg.trigger_threshold ?? 180_000
    const keep = cfg.keep_target ?? 40_000
    edits.push({
      type: "clear_tool_uses_20250919",
      trigger: { type: "token_threshold", value: trigger },
      clear_at_least: { type: "token_count", value: Math.max(0, trigger - keep) },
      exclude_tools: [],
    })
  }
  return edits.length > 0 ? edits : undefined
}