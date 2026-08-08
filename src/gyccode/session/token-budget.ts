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
