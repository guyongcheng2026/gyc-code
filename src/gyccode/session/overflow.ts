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

  const reserved =
    input.cfg.compaction?.reserved ??
    Math.min(COMPACTION_BUFFER, ProviderTransform.maxOutputTokens(input.model, input.outputTokenMax))
  const inputCap = input.model.limit.input !== undefined ? Math.min(input.model.limit.input, context) : context
  return input.model.limit.input
    ? Math.max(0, inputCap - reserved)
    : Math.max(0, context - ProviderTransform.maxOutputTokens(input.model, input.outputTokenMax))
}

export function calculateTokenWarningState(input: {
  used: number
  cfg: ConfigV1.Info
  model: Provider.Model
  outputTokenMax?: number
  limit?: number
}) {
  // 对齐 Claude Code autoCompact.ts 三级告警：WARNING(20K)/ERROR(13K)/BLOCKING(3K)
  // 缓冲相对 usable 有效窗口计算，percentLeft 表示剩余可用比例。
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

export function isOverflow(input: {
  cfg: ConfigV1.Info
  tokens: SessionV1.Assistant["tokens"]
  model: Provider.Model
  outputTokenMax?: number
}) {
  if (input.cfg.compaction?.auto === false) return false
  if (input.model.limit.context === 0) return false

  const count =
    input.tokens.total || input.tokens.input + input.tokens.output + input.tokens.cache.read + input.tokens.cache.write
  return count >= usable(input)
}
