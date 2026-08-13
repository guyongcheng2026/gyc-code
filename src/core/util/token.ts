export * as Token from "./token"

import { count, tokenize } from "./tokenizer"

// Token estimation is backed by the local tokenizer: `estimate` runs the same
// deterministic, linear-time tokenize pass that `tokenize` exposes, so counts
// are consistent everywhere (CJK = 1 token/char, code symbols tokenize
// individually, ASCII runs cluster into word-ish tokens). It counts without
// materializing the token array to keep hot paths (sidebar refresh, prompt
// build) free of per-call allocations. `estimateWithAPI` delegates to an
// injected Anthropic countTokens when available and falls back to the local
// `estimate` on any failure.

export const estimate = (input: string) => {
  if (!input) return 0
  return count(input)
}

export async function estimateWithAPI(
  input: string,
  opts: { api?: { countTokens: (text: string) => Promise<number> }; model?: string } = {},
): Promise<number> {
  if (opts.api && opts.model) {
    try {
      const n = await opts.api.countTokens(input)
      if (typeof n === "number" && Number.isInteger(n) && n >= 0) return n
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

type AnthropicBlock =
  | { type: "text"; text?: string }
  | { type: "image"; source?: unknown }
  | { type: "tool_use"; name?: string; input?: unknown }
  | { type: "tool_result"; content?: unknown }
  | { type: "thinking"; thinking?: string }

// Per-block token estimation mirroring reference agent's
// roughTokenCountEstimationForBlock. A whole JSON.stringify pass over the
// conversation can't distinguish block types (images cost ~2000 tokens each,
// tool calls are JSON), so block-aware estimation is substantially more
// accurate for mixed content.
export const estimateBlocks = (blocks: readonly AnthropicBlock[]) => {
  let total = 0
  for (const block of blocks) {
    switch (block.type) {
      case "image":
        total += 2000
        break
      case "text":
        total += estimate(block.text ?? "")
        break
      case "thinking":
        total += estimate(block.thinking ?? "")
        break
      case "tool_use": {
        const input = block.input === undefined ? "" : JSON.stringify({ name: block.name, input: block.input })
        total += Math.max(1, Math.ceil(input.length / 4))
        break
      }
      case "tool_result": {
        const raw = block.content
        if (typeof raw === "string") total += estimate(raw)
        else total += estimate(JSON.stringify(raw ?? ""))
        break
      }
      default:
        total += estimate(JSON.stringify(block))
    }
  }
  return total
}
