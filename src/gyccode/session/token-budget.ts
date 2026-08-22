const TOKEN_SUFFIX_MAP: Record<string, number> = {
  k: 1_000,
  m: 1_000_000,
  g: 1_000_000_000,
  t: 1_000,  // "t" for thousand (ambiguous, prefer k)
}

const TOKEN_PATTERN = /^[+]?(\d+[.]?\d*)\s*(k|m|g|t|tokens?)?$/i

export function parseTokenBudget(input: string): number | null {
  const trimmed = input.trim().toLowerCase()
  const match = trimmed.match(TOKEN_PATTERN)
  if (!match) return null

  const value = parseFloat(match[1])
  const suffix = match[2]?.replace(/s$/, "") // normalize "tokens" -> "token"

  if (suffix && suffix in TOKEN_SUFFIX_MAP) {
    return Math.round(value * TOKEN_SUFFIX_MAP[suffix])
  }

  return Math.round(value)
}

// Natural language variants
const NL_PATTERNS: Array<{ regex: RegExp; extract: (m: RegExpMatchArray) => number }> = [
  { regex: /use\s+(\d+[.]?\d*)\s*(k|m)?\s*tokens?/i, extract: (m) => {
    const v = parseFloat(m[1])
    const s = m[2]?.toLowerCase()
    return s && s in TOKEN_SUFFIX_MAP ? v * TOKEN_SUFFIX_MAP[s] : v
  }},
  { regex: /limit\s+(?:to\s+)?(\d+[.]?\d*)\s*(k|m)?\s*tokens?/i, extract: (m) => {
    const v = parseFloat(m[1])
    const s = m[2]?.toLowerCase()
    return s && s in TOKEN_SUFFIX_MAP ? v * TOKEN_SUFFIX_MAP[s] : v
  }},
  { regex: /budget\s+(?:of\s+)?(\d+[.]?\d*)\s*(k|m)?\s*tokens?/i, extract: (m) => {
    const v = parseFloat(m[1])
    const s = m[2]?.toLowerCase()
    return s && s in TOKEN_SUFFIX_MAP ? v * TOKEN_SUFFIX_MAP[s] : v
  }},
]

export function parseTokenBudgetNL(input: string): number | null {
  const trimmed = input.trim()
  for (const pattern of NL_PATTERNS) {
    const match = trimmed.match(pattern.regex)
    if (match) {
      return pattern.extract(match)
    }
  }
  return parseTokenBudget(trimmed)
}

export const BUDGET_COMPLETION_THRESHOLD = 0.9
export const BUDGET_DIMINISHING_THRESHOLD = 500
export const BUDGET_DIMINISHING_MIN_CONTINUATIONS = 3

export interface BudgetState {
  /** Total token budget target from the user instruction. */
  budget: number
  /** Tokens consumed toward the budget so far. */
  used: number
  /** Number of continuation turns injected so far. */
  continuations: number
  /** Token increment of the most recent continuation turn. */
  lastIncrement: number
}

export type BudgetAction = "continue" | "complete"

/**
 * Decide whether the run loop should keep going toward a token budget.
 * Continues while usage is below 90% of the target; stops once the target is
 * reached or when continuation turns stop producing meaningful progress
 * (3+ continuations with <500 token increments — diminishing returns).
 */
export function checkTokenBudget(state: BudgetState): { action: BudgetAction } {
  // Diminishing returns takes priority: if continuation turns stopped making
  // meaningful progress, stop even if the budget is not fully consumed.
  if (
    state.continuations >= BUDGET_DIMINISHING_MIN_CONTINUATIONS &&
    state.lastIncrement < BUDGET_DIMINISHING_THRESHOLD
  ) {
    return { action: "complete" }
  }
  const pct = state.used / state.budget
  if (pct < BUDGET_COMPLETION_THRESHOLD) return { action: "continue" }
  return { action: "complete" }
}

/** Synthetic user message that nudges the model to keep working toward the budget. */
export function budgetContinuationMessage(pct: number): string {
  const percent = Math.round(pct * 100)
  return `Stopped at ${percent}% of token target. Keep working — do not summarize. Continue the task until the token budget is used or the work is complete.`
}
