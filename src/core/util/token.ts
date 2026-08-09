export * as Token from "./token"

import { tokenize } from "./tokenizer"

// Token estimation is backed by the local tokenizer: `estimate` runs the same
// deterministic, linear-time tokenize pass that `tokenize` exposes, so counts
// are consistent everywhere (CJK = 1 token/char, code symbols tokenize
// individually, ASCII runs cluster into word-ish tokens). `estimateWithAPI`
// delegates to an injected Anthropic countTokens when available and falls back
// to the local `estimate` on any failure.

export const estimate = (input: string) => {
  if (!input) return 0
  return tokenize(input).length
}

export async function estimateWithAPI(
  input: string,
  opts: { api?: { countTokens: (text: string) => Promise<number> }; model?: string },
): Promise<number> {
  if (opts.api && opts.model) {
    try {
      const n = await opts.api.countTokens(input)
      if (typeof n === "number" && Number.isFinite(n) && n >= 0) return n
    } catch {
      // fall through to local
    }
  }
  return estimate(input)
}

// Compact token count for display: 300000 -> "300K", 1050000 -> "1.05M".
export const format = (value: number) => {
  if (value >= 1_000_000) return `${Number((value / 1_000_000).toFixed(2))}M`
  if (value >= 1_000) return `${Math.round(value / 1_000)}K`
  return `${value}`
}
