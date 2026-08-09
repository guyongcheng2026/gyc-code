/**
 * 1M-context beta header resolution for Anthropic-family providers.
 *
 * Claude Code enables 1M context via the `context-1m-2025-08-07` beta header
 * (utils/context.ts: CONTEXT_1M_BETA_HEADER) for models that advertise a
 * 1M window (context.ts: has1mContext / modelSupports1M). gyc-code reads the
 * model window from the models.dev directory (context: 1_000_000), but until
 * the beta header is sent the Anthropic API still enforces the default 200K
 * limit — picking a 1M model would budget compaction for 1M while the API 413s
 * far earlier. This module closes that gap by injecting the beta header for
 * Anthropic-lineage providers whose advertised context is >= 1M.
 */

export const CONTEXT_1M_BETA_HEADER = "context-1m-2025-08-07" as const
const CONTEXT_1M_THRESHOLD = 1_000_000

/** Provider IDs that implement the Anthropic Messages beta-header protocol. */
const ANTHROPIC_BETA_PROVIDERS = new Set([
  "anthropic",
  "google-vertex-anthropic",
  "amazon-bedrock",
  "openrouter",
  "llmgateway",
  "mailgun",
  "vercel",
])

/** True when the model run meets the AI-SDK npm for an Anthropic-line transport. */
function isAnthropicNpm(npm: string): boolean {
  return (
    npm === "@ai-sdk/anthropic" ||
    npm === "@ai-sdk/google-vertex/anthropic" ||
    npm === "@ai-sdk/amazon-bedrock" ||
    npm === "@openrouter/ai-sdk-provider" ||
    npm === "@llmgateway/ai-sdk-provider"
  )
}

/**
 * Compute the `anthropic-beta` header value for a model that advertises a 1M
 * context window. Returns `undefined` when the model is not 1M-capable on an
 * Anthropic-lineage transport so callers can leave the header untouched.
 *
 * @param model            Provider model (limit.context drives the decision).
 * @param existingBeta     Current `anthropic-beta` value, if any, to merge with.
 */
export function context1MHeader(
  model: {
    providerID: string
    api: { id: string; npm: string }
    limit: { context?: number }
  },
  existingBeta = "",
): string | undefined {
  const context = model.limit?.context ?? 0
  if (context < CONTEXT_1M_THRESHOLD) return undefined
  if (!ANTHROPIC_BETA_PROVIDERS.has(model.providerID) && !isAnthropicNpm(model.api.npm)) return undefined

  const parts = existingBeta
    .split(",")
    .map((p) => p.trim())
    .filter((p) => p.length > 0 && p !== CONTEXT_1M_BETA_HEADER)
  parts.push(CONTEXT_1M_BETA_HEADER)
  return parts.join(",")
}
