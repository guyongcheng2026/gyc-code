/**
 * Local BPE-approximation tokenizer. No network, no dependency — a fast,
 * deterministic token counter that is far more accurate than char/4 heuristics
 * for CJK (1 token per Han char) and code (symbols tokenize individually).
 * ASCII runs cluster into word-ish tokens; unknown content degrades gracefully.
 */

const CJK_RE = /[\u4e00-\u9fff\u3400-\u4dbf\u3000-\u303f\uff00-\uffef]/
const SYMBOL_RE = /[{}[\]();:,.<>~`!@#$%^&*+=\\-_/?'"]/
const WORD_RE = /[A-Za-z0-9_]+/y
// Whitespace run: single token. Reuse a shared regex instead of re-testing
// per char inside the loop.
const WS_RE = /\s/

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
      while (i < n && WS_RE.test(input[i]!)) i++
      tokens.push(" ")
      continue
    }
    WORD_RE.lastIndex = i
    const wordMatch = WORD_RE.exec(input)
    if (wordMatch) {
      tokens.push(wordMatch[0])
      i = WORD_RE.lastIndex
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

/**
 * Count tokens without materializing the token array. The tokenizer is called
 * on every sidebar refresh and prompt build; skipping the array allocation
 * avoids per-call GC pressure on hot paths (the tokens list is frequently
 * discarded after `.length`).
 */
export function count(input: string): number {
  if (!input) return 0
  let total = 0
  let i = 0
  const n = input.length
  while (i < n) {
    const ch = input[i]!
    if (CJK_RE.test(ch)) {
      total++
      i++
      continue
    }
    if (ch === " " || ch === "\t" || ch === "\n" || ch === "\r") {
      while (i < n && WS_RE.test(input[i]!)) i++
      total++
      continue
    }
    WORD_RE.lastIndex = i
    const wordMatch = WORD_RE.exec(input)
    if (wordMatch) {
      total++
      i = WORD_RE.lastIndex
      continue
    }
    if (SYMBOL_RE.test(ch)) {
      total++
      i++
      continue
    }
    total++
    i++
  }
  return total
}
