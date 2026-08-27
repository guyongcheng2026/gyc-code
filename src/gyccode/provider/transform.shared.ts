import type * as Provider from "./provider"
import type * as ModelsDev from "@gyccode/core/models-dev"

export type Modality = NonNullable<ModelsDev.Model["modalities"]>["input"][number]

export function mimeToModality(mime: string): Modality | undefined {
  if (mime.startsWith("image/")) return "image"
  if (mime.startsWith("audio/")) return "audio"
  if (mime.startsWith("video/")) return "video"
  if (mime === "application/pdf") return "pdf"
  return undefined
}

export const OUTPUT_TOKEN_MAX = 32_000

// OpenAI Responses `include` value that returns the encrypted reasoning state
// needed for stateless multi-turn reasoning (store: false). Hoisted so every
// branch that requests it stays in lockstep.
export const INCLUDE_ENCRYPTED_REASONING = ["reasoning.encrypted_content"] as const

export function sanitizeSurrogates(content: string) {
  return content.replace(/[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/g, "\uFFFD")
}

export function isKimiFamily(model: Provider.Model) {
  if (
    [model.providerID, model.api.id].some((id) => {
      const value = id.toLowerCase()
      return value.includes("kimi") || value.includes("moonshot")
    })
  )
    return true
  const url = model.api.url.toLowerCase()
  return ["api.kimi.com", "api.moonshot.ai", "api.moonshot.cn", "api.moonshotai.cn"].some((host) => url.includes(host))
}

// Maps npm package to the key the AI SDK expects for providerOptions
export function sdkKey(npm: string): string | undefined {
  switch (npm) {
    case "@ai-sdk/github-copilot":
      return "copilot"
    case "@ai-sdk/azure":
      return "azure"
    case "@ai-sdk/openai":
      return "openai"
    case "@ai-sdk/amazon-bedrock/mantle":
      return "openai"
    case "@ai-sdk/amazon-bedrock":
      return "bedrock"
    case "@ai-sdk/anthropic":
    case "@ai-sdk/google-vertex/anthropic":
      return "anthropic"
    case "@ai-sdk/google-vertex":
      return "vertex"
    case "@ai-sdk/google":
      return "google"
    case "venice-ai-sdk-provider":
      return "venice"
    case "@ai-sdk/gateway":
      return "gateway"
    case "@openrouter/ai-sdk-provider":
      return "openrouter"
    case "ai-gateway-provider":
      // ai-gateway-provider/unified wraps createOpenAICompatible({ name: "Unified" }),
      // and @ai-sdk/openai-compatible parses compatibleOptions from one of
      // "openai-compatible" / "openaiCompatible" / "Unified" / "unified". The
      // "openai-compatible" key emits a deprecation warning at runtime, so we
      // pick the camelCase form the SDK now treats as canonical.
      return "openaiCompatible"
  }
  return undefined
}
