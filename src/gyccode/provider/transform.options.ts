import { mergeDeep } from "remeda"
import type * as Provider from "./provider"
import { INCLUDE_ENCRYPTED_REASONING, isKimiFamily, OUTPUT_TOKEN_MAX, sdkKey } from "./transform.shared"

const GEMINI_MODELS_WITH_SAMPLING_DEFAULTS = [
  /gemini-2[.-]5(?:[.-]|$)/,
  /gemini-3-(?:flash|pro)(?:[.-]|$)/,
  /gemini-3[.-]1(?:[.-]|$)/,
  /gemini-3[.-]5-flash(?!-lite)(?:[.-]|$)/,
]

export function temperature(model: Provider.Model) {
  const id = model.api.id.toLowerCase()
  if (id.includes("north-mini-code")) return 1.0
  if (id.includes("qwen")) return 0.55
  if (id.includes("claude")) return undefined
  if (id.includes("gemini"))
    return GEMINI_MODELS_WITH_SAMPLING_DEFAULTS.some((model) => model.test(id)) ? 1.0 : undefined
  if (id.includes("glm-4.6")) return 1.0
  if (id.includes("glm-4.7")) return 1.0
  if (id.includes("minimax-m2")) return 1.0
  if (id.includes("kimi-k2")) {
    // kimi-k2-thinking & kimi-k2.5 && kimi-k2p5 && kimi-k2-5
    if (["thinking", "k2.", "k2p", "k2-5"].some((s) => id.includes(s))) {
      return 1.0
    }
    return 0.6
  }
  return undefined
}

export function topP(model: Provider.Model) {
  const id = model.api.id.toLowerCase()
  if (id.includes("qwen")) return 1
  if (id.includes("gemini"))
    return GEMINI_MODELS_WITH_SAMPLING_DEFAULTS.some((model) => model.test(id)) ? 0.95 : undefined
  if (["minimax-m2", "kimi-k2.5", "kimi-k2p5", "kimi-k2-5"].some((s) => id.includes(s))) {
    return 0.95
  }
  return undefined
}

export function topK(model: Provider.Model) {
  const id = model.api.id.toLowerCase()
  if (id.includes("minimax-m2")) {
    if (["m2.", "m25", "m21"].some((s) => id.includes(s))) return 40
    return 20
  }
  if (id.includes("gemini"))
    return GEMINI_MODELS_WITH_SAMPLING_DEFAULTS.some((model) => model.test(id)) ? 64 : undefined
  return undefined
}

export function options(input: {
  model: Provider.Model
  sessionID: string
  providerOptions?: Record<string, any>
}): Record<string, any> {
  const result: Record<string, any> = {}

  if (
    input.model.api.npm === "@ai-sdk/google-vertex/anthropic" ||
    (!input.model.api.id.includes("claude") && input.model.api.npm === "@ai-sdk/anthropic")
  ) {
    result["toolStreaming"] = false
  }

  // openai and providers using openai package should set store to false by default.
  if (
    input.model.providerID === "openai" ||
    input.model.api.npm === "@ai-sdk/openai" ||
    input.model.api.npm === "@ai-sdk/github-copilot" ||
    input.model.api.npm === "@ai-sdk/amazon-bedrock/mantle"
  ) {
    result["store"] = false
  }

  if (input.model.api.npm === "@ai-sdk/azure") {
    result["store"] = false
  }

  if (input.model.api.npm === "@openrouter/ai-sdk-provider" || input.model.api.npm === "@llmgateway/ai-sdk-provider") {
    result["usage"] = {
      include: true,
    }
    if (input.model.api.id.includes("gemini-3")) {
      result["reasoning"] = { effort: "high" }
    }
  }

  if (
    input.model.providerID === "baseten" ||
    (input.model.providerID === "gyccode" && ["kimi-k2-thinking", "glm-4.6"].includes(input.model.api.id))
  ) {
    result["chat_template_args"] = { enable_thinking: true }
  }

  if (
    ["zai", "zhipuai"].some((id) => input.model.providerID.includes(id)) &&
    input.model.api.npm === "@ai-sdk/openai-compatible"
  ) {
    result["thinking"] = {
      type: "enabled",
      clear_thinking: false,
    }
  }

  if (input.model.providerID === "meta" && input.model.api.npm === "@ai-sdk/openai") {
    result["reasoningSummary"] = "auto"
    result["include"] = INCLUDE_ENCRYPTED_REASONING
  }

  if (input.model.api.npm === "@ai-sdk/google" || input.model.api.npm === "@ai-sdk/google-vertex") {
    if (input.model.capabilities.reasoning) {
      result["thinkingConfig"] = {
        includeThoughts: true,
      }
      if (input.model.api.id.includes("gemini-3")) {
        result["thinkingConfig"]["thinkingLevel"] = "high"
      }
    }
  }

  const modelId = input.model.api.id.toLowerCase()

  // MiniMax's Anthropic interface defaults thinking off, unlike Chat Completions.
  if (modelId.includes("minimax-m3") && input.model.api.npm === "@ai-sdk/anthropic") {
    result["thinking"] = { type: "adaptive" }
  }

  // Moonshot's Anthropic-compatible API uses adaptive effort rather than token budgets.
  // Request summaries so thinking content survives replay on subsequent turns.
  if (
    ["@ai-sdk/anthropic", "@ai-sdk/google-vertex/anthropic"].includes(input.model.api.npm) &&
    isKimiFamily(input.model) &&
    input.model.capabilities.reasoning
  ) {
    result["thinking"] = { type: "adaptive", display: "summarized" }
    result["effort"] = "high"
  }

  if (input.providerOptions?.setCacheKey !== false) {
    if (
      input.model.api.npm === "@ai-sdk/openai" ||
      input.model.api.npm === "@ai-sdk/azure" ||
      input.model.api.npm === "venice-ai-sdk-provider" ||
      // openai-compatible endpoints (e.g. gyccode) expose the same prompt
      // caching mechanism via providerOptions.openai.promptCacheKey.
      input.model.api.npm === "@ai-sdk/openai-compatible" ||
      input.providerOptions?.setCacheKey === true
    ) {
      result["promptCacheKey"] = input.sessionID
    }
  }

  if (input.model.api.npm === "@ai-sdk/gateway") {
    result["gateway"] = { caching: "auto" }
  }

  // Any gpt version above 5.4 in combination with azure does not support reasoningEffort
  // so we should return early here.
  const [, gptMajorVersion, gptMinorVersion] = input.model.api.id.match(/gpt-(\d+)\.(\d+)/) ?? []
  const isGpt55OrNewer = Number(gptMajorVersion) > 5 || (Number(gptMajorVersion) === 5 && Number(gptMinorVersion) >= 5)
  if (input.model.api.npm === "@ai-sdk/azure" && input.providerOptions?.useCompletionUrls) {
    if (!isGpt55OrNewer) {
      result["reasoningEffort"] = "medium"
    }
    return result
  }

  if (input.model.api.id.includes("gpt-5") && !input.model.api.id.includes("gpt-5-chat")) {
    if (!input.model.api.id.includes("gpt-5-pro")) {
      result["reasoningEffort"] = "medium"
      if (
        input.model.api.npm === "@ai-sdk/openai" ||
        input.model.api.npm === "@ai-sdk/azure" ||
        input.model.api.npm === "@ai-sdk/github-copilot" ||
        input.model.api.npm === "@ai-sdk/amazon-bedrock/mantle"
      ) {
        result["reasoningSummary"] = "auto"
      }
      if (input.model.api.npm === "@ai-sdk/openai" || input.model.api.npm === "@ai-sdk/amazon-bedrock/mantle") {
        result["include"] = INCLUDE_ENCRYPTED_REASONING
      }
    }

    // Only set textVerbosity for non-chat gpt-5.x models
    // Chat models (e.g. gpt-5.2-chat-latest) only support "medium" verbosity
    if (
      input.model.api.id.includes("gpt-5.") &&
      !input.model.api.id.includes("codex") &&
      !input.model.api.id.includes("-chat") &&
      input.model.providerID !== "azure"
    ) {
      result["textVerbosity"] = "low"
    }

    if (input.model.providerID.startsWith("gyccode") && input.providerOptions?.setCacheKey !== false) {
      result["promptCacheKey"] = input.sessionID
      result["include"] = INCLUDE_ENCRYPTED_REASONING
      result["reasoningSummary"] = "auto"
    }
  }

  return result
}

export function smallOptions(model: Provider.Model) {
  const small = Object.values(model.variants ?? {})[0] ?? {}
  if (
    model.providerID === "openai" ||
    model.api.npm === "@ai-sdk/openai" ||
    model.api.npm === "@ai-sdk/github-copilot"
  ) {
    const base = { store: false }
    return mergeDeep(base, small)
  }
  if (model.providerID === "openrouter" || model.providerID === "llmgateway") {
    if (Object.keys(small).length === 0 && model.api.id.includes("google")) {
      return { reasoning: { enabled: false } }
    }
  }

  if (model.providerID === "venice") {
    if (Object.keys(small).length > 0) return small
    return { veniceParameters: { disableThinking: true } }
  }

  return small
}

// Maps model ID prefix to provider slug used in providerOptions.
// Example: "amazon/nova-2-lite" → "bedrock"
const SLUG_OVERRIDES: Record<string, string> = {
  amazon: "bedrock",
}

// options 为透传给各 @ai-sdk 工厂的自由格式选项（每个 SDK 期望的形状不同），
// 改为 unknown 会让全部透传点报错；形状校验由各 SDK 自行完成。
export function providerOptions(model: Provider.Model, options: { [x: string]: any }) {
  const usesOpenAIReasoningGate =
    model.api.npm === "@ai-sdk/openai" ||
    model.api.npm === "@ai-sdk/azure" ||
    model.api.npm === "@ai-sdk/amazon-bedrock/mantle"
  const normalized =
    usesOpenAIReasoningGate &&
    (model.capabilities.reasoning || options.reasoningEffort !== undefined || options.reasoningSummary !== undefined)
      ? { ...options, forceReasoning: true }
      : options

  if (model.api.npm === "@ai-sdk/gateway") {
    // Gateway providerOptions are split across two namespaces:
    // - `gateway`: gateway-native routing/caching controls (order, only, byok, etc.)
    // - `<upstream slug>`: provider-specific model options (anthropic/openai/...)
    // We keep `gateway` as-is and route every other top-level option under the
    // model-derived upstream slug.
    const i = model.api.id.indexOf("/")
    const rawSlug = i > 0 ? model.api.id.slice(0, i) : undefined
    const slug = rawSlug ? (SLUG_OVERRIDES[rawSlug] ?? rawSlug) : undefined
    const gateway = normalized.gateway
    const rest = Object.fromEntries(Object.entries(normalized).filter(([k]) => k !== "gateway"))
    const has = Object.keys(rest).length > 0

    const result: Record<string, any> = {}
    if (gateway !== undefined) result.gateway = gateway

    if (has) {
      if (slug) {
        // Route model-specific options under the provider slug
        result[slug] = rest
      } else if (gateway && typeof gateway === "object" && !Array.isArray(gateway)) {
        result.gateway = { ...gateway, ...rest }
      } else {
        result.gateway = rest
      }
    }

    return result
  }

  // AI SDK packages that resolve providerOptionsName by splitting the
  // provider name on "." (e.g. "wafer.ai" -> "wafer") need the same
  // logic here so the key we write matches the key they read.
  // Other SDKs (xai, mistral, groq, cohere, etc.) use hardcoded keys
  // like "xai" or "cohere" - applying .split(".")[0] would break those.
  const usesDotSplitOptions =
    model.api.npm === "@ai-sdk/openai-compatible" ||
    model.api.npm === "@ai-sdk/openai" ||
    model.api.npm === "@ai-sdk/anthropic"
  const key = sdkKey(model.api.npm) ?? (usesDotSplitOptions ? model.providerID.split(".")[0] : model.providerID)
  // @ai-sdk/azure delegates to OpenAIChatLanguageModel which reads from
  // providerOptions["openai"], but OpenAIResponsesLanguageModel checks
  // "azure" first. Pass both so model options work on either code path.
  if (model.api.npm === "@ai-sdk/azure") {
    return { openai: normalized, azure: normalized }
  }
  return { [key]: normalized }
}

export function maxOutputTokens(
  model: Provider.Model,
  outputTokenMax: number | undefined = OUTPUT_TOKEN_MAX,
): number {
  const cap = outputTokenMax ?? OUTPUT_TOKEN_MAX
  return Math.min(model.limit.output, cap) || cap
}
