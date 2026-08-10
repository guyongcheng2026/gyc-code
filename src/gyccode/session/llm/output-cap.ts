/**
 * Slot reservation (mirrors Claude Code CAPPED_DEFAULT_MAX_TOKENS):
 * default 8K for normal requests, escalated to 64K on finish=length.
 */
const CAPPED_DEFAULT_MAX_TOKENS = 8_000
const ESCALATED_MAX_TOKENS = 64_000

/**
 * Effective output-token cap for a request: runtime flag wins, else the config
 * `llm.output_token_max` value. Defaults to 8K slot reservation.
 */
export function resolveOutputTokenMax(
  flags: { outputTokenMax?: number },
  cfg: { llm?: { output_token_max?: number } },
): number | undefined {
  return flags.outputTokenMax ?? cfg.llm?.output_token_max ?? CAPPED_DEFAULT_MAX_TOKENS
}

/**
 * Output-cap escalation on a finish="length" turn: bounded by the model's own
 * output limit and the configurable escalate ceiling (default 64k).
 */
export function escalateOutputMax(model: { limit: { output: number } }, escalateMax?: number): number {
  return Math.min(model.limit.output, escalateMax ?? 64_000)
}