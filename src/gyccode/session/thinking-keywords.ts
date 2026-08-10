// Thinking-keyword → reasoning-effort upgrade (mirrors Claude Code hasUltrathinkKeyword).
//
// When a user's prompt contains a thinking directive ("think", "think hard",
// "think deeply", "ultrathink"), gyc upgrades the reasoning effort variant to
// the strongest available tier, gated by the model's declared variants. This
// lets users opt into deeper reasoning per-message without a manual variant
// switch, and surpasses Claude Code, whose keyword upgrade is Anthropic-only
// and build-gated.

/** Ordered weakest→strongest reasoning effort tiers. */
const EFFORT_ORDER = ["low", "medium", "high", "xhigh", "max"] as const

/** Keyword → minimum effort tier to upgrade to. */
const KEYWORD_EFFORT: ReadonlyArray<readonly [RegExp, string]> = [
  [/ultrathink/i, "max"],
  [/think harder|think deeply|think very hard|deep think/i, "xhigh"],
  [/\bthink\b/i, "high"],
]

/**
 * Extract the thinking keyword from a user's text parts.
 * Returns the strongest matched keyword's target effort, or undefined.
 */
export function thinkingKeywordTarget(text: string): string | undefined {
  if (!text) return undefined
  for (const [re, effort] of KEYWORD_EFFORT) {
    if (re.test(text)) return effort
  }
  return undefined
}

/**
 * Pick the strongest available variant at or above the target effort.
 * Falls back to the target itself if present, else the last (strongest)
 * available variant, else undefined.
 */
export function resolveThinkingVariant(
  target: string | undefined,
  variants: Record<string, unknown> | undefined,
): string | undefined {
  if (!target || !variants) return undefined
  const available = Object.keys(variants)
  if (available.length === 0) return undefined

  const targetIndex = EFFORT_ORDER.indexOf(target as (typeof EFFORT_ORDER)[number])
  if (targetIndex === -1) return available.includes(target) ? target : undefined

  // Prefer an exact or stronger available tier, otherwise the strongest available.
  for (let i = targetIndex; i < EFFORT_ORDER.length; i++) {
    if (available.includes(EFFORT_ORDER[i])) return EFFORT_ORDER[i]
  }
  // Fall back to the last (strongest) available tier.
  return available[available.length - 1]
}