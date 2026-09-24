import type { Config } from "@/config/config"
import { ConfigV1 } from "@gyccode/core/v1/config/config"
import { SessionV1 } from "@gyccode/core/v1/session"
import type { Provider } from "@/provider/provider"
import { ProviderTransform } from "@/provider/transform"
import type { MessageV2 } from "./message-v2"
import { effectiveContextWindow } from "./llm/context-1m"

const COMPACTION_BUFFER = 20_000

export function usable(input: { cfg: ConfigV1.Info; model: Provider.Model; outputTokenMax?: number }) {
  const context = effectiveContextWindow(input.model.limit)
  if (context === 0) return 0

  const maxOutput = ProviderTransform.maxOutputTokens(input.model, input.outputTokenMax)
  const reserved = input.cfg.compaction?.reserved ?? Math.min(COMPACTION_BUFFER, maxOutput)

  // If model declares input limit, usable is min(input_limit, context) - reserved
  // Otherwise usable is context - max_output (reserved for output)
  const usableTokens = input.model.limit.input !== undefined
    ? Math.max(0, Math.min(input.model.limit.input, context) - reserved)
    : Math.max(0, context - maxOutput)

  // Defensive: usableTokens should never be negative due to Math.max(0, ...) above
  // but add assertion for clarity
  return usableTokens
}

export function calculateTokenWarningState(input: {
  used: number
  cfg: ConfigV1.Info
  model: Provider.Model
  outputTokenMax?: number
  limit?: number
}) {
  // Align with reference agent autoCompact.ts three-tier warning: WARNING(20K)/ERROR(13K)/BLOCKING(3K)
  // Buffer calculated relative to usable effective window, percentLeft = remaining usable ratio.
  const WARNING_BUFFER = 20_000
  const ERROR_BUFFER = 13_000
  const BLOCKING_BUFFER = 3_000

  const usableTokens = Math.max(0, input.limit ?? usable(input))
  const remaining = Math.max(0, usableTokens - input.used)

  return {
    percentLeft: usableTokens <= 0 ? 0 : Math.min(100, (remaining / usableTokens) * 100),
    isAboveWarning: remaining <= WARNING_BUFFER,
    isAboveError: remaining <= ERROR_BUFFER,
    isAboveBlocking: remaining <= BLOCKING_BUFFER,
    remaining,
  }
}

/**
 * Suggest 1M context upgrade when usage exceeds 70% and model supports 1M.
 * Mirrors reference agent contextWindowUpgradeCheck.
 */
export function maybeSuggest1mUpgrade(input: {
  used: number
  cfg: ConfigV1.Info
  model: Provider.Model
  outputTokenMax?: number
}): string | undefined {
  const usableTokens = usable(input)
  if (usableTokens <= 0) return undefined
  const percentUsed = (input.used / usableTokens) * 100
  if (percentUsed < 70) return undefined
  const modelId = input.model.id.toLowerCase()
  if (modelId.includes('[1m]')) return undefined
  return 'Context usage at ' + Math.round(percentUsed) + '%. Consider upgrading to a 1M context model (append [1m] to model ID).'
}

export function isOverflow(input: {
  cfg: ConfigV1.Info
  tokens: SessionV1.Assistant["tokens"]
  model: Provider.Model
  outputTokenMax?: number
}) {
  if (input.cfg.compaction?.auto === false) return false
  if (input.model.limit.context === 0) return false

  // All token fields may be missing: any undefined makes sum NaN, NaN >= x is always
  // false (auto-compact never triggers), so each field must be ?? 0
  // Note: cannot short-circuit on usable <= 0 -- model.limit.context = 0 but after
  // subtracting output reserve usable = 0 means "any input counts as overflow"
  // (see overflow.regression test case)
  // P1 fix: use ?? not ||, so when total = 0 we still sum other fields
  const count =
    (input.tokens.total ?? 0) +
    (input.tokens.input ?? 0) +
    (input.tokens.output ?? 0) +
    (input.tokens.cache.read ?? 0) +
    (input.tokens.cache.write ?? 0)
  return count >= usable(input)
}