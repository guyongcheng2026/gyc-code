/**
 * Local BPE-approximation tokenizer. No network, no dependency — a fast,
 * deterministic token counter that is far more accurate than char/4 heuristics
 * for CJK (1 token per Han char) and code (symbols tokenize individually).
 * ASCII runs cluster into word-ish tokens; unknown content degrades gracefully.
 */

const CJK_RE = /[\u4e00-\u9fff\u3400-\u4dbf\u3000-\u303f\uff00-\uffef]/
const SYMBOL_RE = /[{}[\]();:,.<>~`!@#$%^&*+=\\-_/?'"]/

export function tokenize(input: string): string[] {
  if (!input) return []
  const tokens: string[] = []
  let i = 0
  const n = input.length
  while (i < n) {
    const ch = input[i]!
    if (CJK_RE.test(ch)) {
      tokens.push(ch)
      i++
      continue
    }
    if (ch === " " || ch === "\t" || ch === "\n" || ch === "\r") {
      while (i < n && /\s/.test(input[i]!)) i++
      tokens.push(" ")
      continue
    }
    const wordMatch = input.slice(i).match(/^[A-Za-z0-9_]+/)
    if (wordMatch) {
      tokens.push(wordMatch[0])
      i += wordMatch[0].length
      continue
    }
    if (SYMBOL_RE.test(ch)) {
      tokens.push(ch)
      i++
      continue
    }
    tokens.push(ch)
    i++
  }
  return tokens
}