/**
 * Effective output-token cap for a request: runtime flag wins, else the config
 * `llm.output_token_max` value. The 32k default is applied downstream
 * (ProviderTransform.maxOutputTokens) when this returns undefined.
 */
export function resolveOutputTokenMax(
  flags: { outputTokenMax?: number },
  cfg: { llm?: { output_token_max?: number } },
): number | undefined {
  return flags.outputTokenMax ?? cfg.llm?.output_token_max
}

/**
 * Output-cap escalation on a finish="length" turn: bounded by the model's own
 * output limit and the configurable escalate ceiling (default 64k).
 */
export function escalateOutputMax(model: { limit: { output: number } }, escalateMax?: number): number {
  return Math.min(model.limit.output, escalateMax ?? 64_000)
}