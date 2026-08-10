/**
 * API-native context management (Anthropic `context-management` beta).
 * Lets the API clear old thinking blocks / tool uses server-side, shrinking
 * the request without a client-side compaction round. Aligned with Claude
 * Code's apiMicrocompact, but universally configurable (Claude gates tool
 * clearing behind ant-only env flags).
 */

import { mergeBetaHeader } from "./context-1m"

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
  | {
      type: "clear_thinking_20251015"
      keep?: "all" | { type: "thinking_turns"; value: number }
    }
  | {
      type: "clear_tool_uses_20250919"
      trigger?: { type: "input_tokens" | "tool_uses"; value: number }
      keep?: { type: "tool_uses"; value: number }
      clearAtLeast?: { type: "input_tokens"; value: number }
      clearToolInputs?: boolean
      excludeTools?: string[]
    }

export function contextManagementEdits(cfg: ContextManagementConfig): ContextManagementEdit[] | undefined {
  if (!cfg.enabled) return undefined
  const edits: ContextManagementEdit[] = []
  if (cfg.clear_thinking !== false) {
    edits.push({ type: "clear_thinking_20251015", keep: { type: "thinking_turns", value: cfg.thinking_turns ?? 1 } })
  }
  if (cfg.clear_tool_uses) {
    const trigger = cfg.trigger_threshold ?? 180_000
    const keep = cfg.keep_target ?? 40_000
    // `excludeTools` is optional on the wire and no config path populates it,
    // so the emitted edit omits it entirely.
    edits.push({
      type: "clear_tool_uses_20250919",
      trigger: { type: "input_tokens", value: trigger },
      clearAtLeast: { type: "input_tokens", value: Math.max(0, trigger - keep) },
    })
  }
  return edits.length > 0 ? edits : undefined
}

/** Merge the context-management beta into an existing anthropic-beta value (comma, dedup). */
export function contextManagementBetaHeader(
  existingBeta: string | undefined,
  enabled: boolean,
  isAnthropic: boolean,
): string | undefined {
  if (!enabled || !isAnthropic) return existingBeta
  return mergeBetaHeader(existingBeta, CONTEXT_MANAGEMENT_BETA_HEADER)
}

/** Context-management provider options for the request, or undefined when nothing applies. */
export function contextManagementOptions(
  cfg: ContextManagementConfig,
): { contextManagement: { edits: ContextManagementEdit[] } } | undefined {
  const edits = contextManagementEdits(cfg)
  return edits ? { contextManagement: { edits } } : undefined
}
