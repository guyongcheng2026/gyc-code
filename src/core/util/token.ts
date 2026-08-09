export * as Token from "./token"

// Character-per-token heuristics (aligned with Claude Code's type-aware
// tokenEstimation): plain ASCII prose ~4 chars/token, JSON ~2 (dense single
// char tokens), CJK ~1.5 (each Han char typically maps to 1-2 tokens), and
// code-dense content ~3 (symbols/punctuation add token weight). These keep
// compaction triggers close to real usage without a full tokenizer.
const CHARS_PER_TOKEN = 4
const JSON_CHARS_PER_TOKEN = 2
const CJK_CHARS_PER_TOKEN = 1.5
const CODE_CHARS_PER_TOKEN = 3

// Han + full-width punctuation (CJK Unified Ideographs, Extension A, CJK
// punctuation, full-width forms).
const CJK_RE = /[\u4e00-\u9fff\u3400-\u4dbf\u3000-\u303f\uff00-\uffef]/
// Characters that add density in code (symbols, punctuation).
const CODE_DENSE_RE = /[{}[\]();:,<>~`!@#$%^&*+=\\-_/\\?.'"]/

export const estimate = (input: string) => {
  if (!input) return 0
  if (isJson(input)) return Math.max(0, Math.round(input.length / JSON_CHARS_PER_TOKEN))

  let cjk = 0
  let codeDense = 0
  let rest = 0
  for (const ch of input) {
    if (CJK_RE.test(ch)) cjk++
    else if (CODE_DENSE_RE.test(ch)) codeDense++
    else rest++
  }

  // Weighted char-per-token: CJK chars are densest, code symbols next, prose lightest.
  const weighted = cjk / CJK_CHARS_PER_TOKEN + codeDense / CODE_CHARS_PER_TOKEN + rest / CHARS_PER_TOKEN
  return Math.max(0, Math.round(weighted))
}

function isJson(input: string) {
  const head = input.trimStart()
  return head.startsWith("{") || head.startsWith("[")
}

// Compact token count for display: 300000 -> "300K", 1050000 -> "1.05M".
export const format = (value: number) => {
  if (value >= 1_000_000) return `${Number((value / 1_000_000).toFixed(2))}M`
  if (value >= 1_000) return `${Math.round(value / 1_000)}K`
  return `${value}`
}
