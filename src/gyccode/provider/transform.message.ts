import type { AssistantContent, ModelMessage, ToolContent, ToolResultPart, UserContent } from "ai"
import { mergeDeep, unique } from "remeda"
import type * as Provider from "./provider"
import { mimeToModality, sanitizeSurrogates, sdkKey } from "./transform.shared"

function sanitizeToolResultOutput(content: ToolResultPart): ToolResultPart {
  if (content.output.type === "text" || content.output.type === "error-text") {
    return { ...content, output: { ...content.output, value: sanitizeSurrogates(content.output.value) } }
  }
  if (content.output.type === "content") {
    return {
      ...content,
      output: {
        ...content.output,
        value: content.output.value.map((item) =>
          item.type === "text" ? { ...item, text: sanitizeSurrogates(item.text) } : item,
        ),
      },
    }
  }
  return content
}

function sanitizeMessage(msg: ModelMessage): ModelMessage {
  switch (msg.role) {
    case "tool":
      if (!Array.isArray(msg.content)) return msg
      return {
        ...msg,
        content: msg.content.map((content) =>
          content.type === "tool-result" ? sanitizeToolResultOutput(content) : content,
        ) as ToolContent,
      }

    case "system":
      return { ...msg, content: sanitizeSurrogates(msg.content) }

    case "user":
      if (typeof msg.content === "string") {
        return { ...msg, content: sanitizeSurrogates(msg.content) }
      }
      return {
        ...msg,
        content: msg.content.map((content) =>
          content.type === "text" ? { ...content, text: sanitizeSurrogates(content.text) } : content,
        ) as UserContent,
      }

    case "assistant":
      if (typeof msg.content === "string") {
        return { ...msg, content: sanitizeSurrogates(msg.content) }
      }
      return {
        ...msg,
        content: msg.content.map((content) => {
          if (content.type === "text" || content.type === "reasoning") {
            return { ...content, text: sanitizeSurrogates(content.text) }
          }
          if (content.type === "tool-result") {
            return sanitizeToolResultOutput(content)
          }
          return content
        }) as AssistantContent,
      }

    default:
      return msg
  }
}

function scrubToolCallIds(msg: ModelMessage, scrub: (id: string) => string): ModelMessage {
  if (msg.role === "assistant" && Array.isArray(msg.content)) {
    return {
      ...msg,
      content: msg.content.map((part) =>
        part.type === "tool-call" || part.type === "tool-result"
          ? { ...part, toolCallId: scrub(part.toolCallId) }
          : part,
      ),
    }
  }
  if (msg.role === "tool" && Array.isArray(msg.content)) {
    return {
      ...msg,
      content: msg.content.map((part) =>
        part.type === "tool-result" ? { ...part, toolCallId: scrub(part.toolCallId) } : part,
      ),
    }
  }
  return msg
}

// 过滤空内容（Anthropic/Bedrock 拒绝空 content）。单次遍历，纯函数。
function filterEmptyContent(providerKey: string, msgs: ModelMessage[]): ModelMessage[] {
  const result: ModelMessage[] = []
  for (const msg of msgs) {
    if (typeof msg.content === "string") {
      if (msg.content !== "") result.push(msg)
      continue
    }
    if (!Array.isArray(msg.content)) {
      result.push(msg)
      continue
    }
    const filtered = msg.content.filter((part) => {
      if (part.type === "text") {
        return part.text !== ""
      }
      if (part.type === "reasoning") {
        return (
          part.text.trim().length > 0 ||
          part.providerOptions?.[providerKey]?.signature != null ||
          part.providerOptions?.[providerKey]?.redactedData != null
        )
      }
      return true
    })
    if (filtered.length > 0) result.push({ ...msg, content: filtered } as ModelMessage)
  }
  return result
}

export function normalizeMessages(
  msgs: ModelMessage[],
  model: Provider.Model,
  _options: Record<string, unknown>,
): ModelMessage[] {
  // 1) 无条件清洗孤立代理项（代理项对部分厂商非法）。
  msgs = msgs.map(sanitizeMessage)

  // 2) Anthropic / Bedrock 拒绝空 content。
  if (model.api.npm === "@ai-sdk/anthropic") {
    msgs = filterEmptyContent("anthropic", msgs)
  }
  if (model.api.npm === "@ai-sdk/amazon-bedrock") {
    msgs = filterEmptyContent("bedrock", msgs)
  }

  // 3) Claude：toolCallId 只允许 [a-zA-Z0-9_-]。
  if (model.api.id.includes("claude")) {
    const scrub = (id: string) => id.replace(/[^a-zA-Z0-9_-]/g, "_")
    msgs = msgs.map((msg) => scrubToolCallIds(msg, scrub))
  }

  // 4) Mistral 系：toolCallId 压缩为 9 位；tool 消息后不能紧跟 user 消息。
  const modelID = model.api.id.toLowerCase()
  if (
    model.providerID === "mistral" ||
    ["mistral", "devstral", "codestral", "pixtral", "mixtral"].some((family) => modelID.includes(family))
  ) {
    const scrub = (id: string) => {
      return id
        .replace(/[^a-zA-Z0-9]/g, "") // Remove non-alphanumeric characters
        .substring(0, 9) // Take first 9 characters
        .padEnd(9, "0") // Pad with zeros if less than 9 characters
    }
    const result: ModelMessage[] = []
    for (let i = 0; i < msgs.length; i++) {
      const msg = msgs[i]
      const nextMsg = msgs[i + 1]
      result.push(scrubToolCallIds(msg, scrub))

      // Fix message sequence: tool messages cannot be followed by user messages
      if (msg.role === "tool" && nextMsg?.role === "user") {
        result.push({
          role: "assistant",
          content: [
            {
              type: "text",
              text: "Done.",
            },
          ],
        })
      }
    }
    return result
  }

  // 5) DeepSeek：assistant 消息必须带 reasoning part。
  if (model.api.id.toLowerCase().includes("deepseek")) {
    msgs = msgs.map((msg) => {
      if (msg.role !== "assistant") return msg
      if (Array.isArray(msg.content)) {
        if (msg.content.some((part) => part.type === "reasoning")) return msg
        return { ...msg, content: [...msg.content, { type: "reasoning", text: "" }] }
      }
      return {
        ...msg,
        content: [
          ...(msg.content ? [{ type: "text" as const, text: msg.content }] : []),
          { type: "reasoning" as const, text: "" },
        ],
      }
    })
  }

  // 6) 交互式推理厂商（如 DeepSeek）：把 reasoning 投影到 providerOptions 字段，
  //    保留空串（部分厂商返回空 reasoning_content 仍需回传）。
  if (
    typeof model.capabilities.interleaved === "object" &&
    model.capabilities.interleaved.field &&
    model.api.npm !== "@openrouter/ai-sdk-provider"
  ) {
    const field = model.capabilities.interleaved.field
    return msgs.map((msg) => {
      if (msg.role === "assistant" && Array.isArray(msg.content)) {
        const reasoningText = msg.content.map((part) => (part.type === "reasoning" ? part.text : "")).join("")
        const filteredContent = msg.content.filter((part) => part.type !== "reasoning")
        return {
          ...msg,
          content: filteredContent,
          providerOptions: {
            ...msg.providerOptions,
            openaiCompatible: {
              ...msg.providerOptions?.openaiCompatible,
              [field]: reasoningText,
            },
          },
        }
      }
      return msg
    })
  }

  return msgs
}


function applyCaching(msgs: ModelMessage[], model: Provider.Model): ModelMessage[] {
  const system = msgs.filter((msg) => msg.role === "system").slice(0, 2)
  const final = msgs.filter((msg) => msg.role !== "system").slice(-2)

  const providerOptions = {
    anthropic: {
      cacheControl: { type: "ephemeral" },
    },
    openrouter: {
      cacheControl: { type: "ephemeral" },
    },
    bedrock: {
      cachePoint: { type: "default" },
    },
    openaiCompatible: {
      cache_control: { type: "ephemeral" },
    },
    copilot: {
      copilot_cache_control: { type: "ephemeral" },
    },
  }

  for (const msg of unique([...system, ...final])) {
    const useMessageLevelOptions =
      model.providerID === "anthropic" ||
      model.providerID.includes("bedrock") ||
      model.api.npm === "@ai-sdk/amazon-bedrock"
    const shouldUseContentOptions = !useMessageLevelOptions && Array.isArray(msg.content) && msg.content.length > 0

    if (shouldUseContentOptions) {
      const lastContent = msg.content[msg.content.length - 1]
      if (
        lastContent &&
        typeof lastContent === "object" &&
        lastContent.type !== "tool-approval-request" &&
        lastContent.type !== "tool-approval-response"
      ) {
        lastContent.providerOptions = mergeDeep(lastContent.providerOptions ?? {}, providerOptions)
        continue
      }
    }

    msg.providerOptions = mergeDeep(msg.providerOptions ?? {}, providerOptions)
  }

  return msgs
}

function unsupportedParts(msgs: ModelMessage[], model: Provider.Model): ModelMessage[] {
  return msgs.map((msg) => {
    if (msg.role !== "user" || !Array.isArray(msg.content)) return msg

    const filtered = msg.content.map((part) => {
      if (part.type !== "file" && part.type !== "image") return part

      // Check for empty base64 image data
      if (part.type === "image") {
        const imageStr = String(part.image)
        if (imageStr.startsWith("data:")) {
          const match = imageStr.match(/^data:([^;]+);base64,(.*)$/)
          if (match && (!match[2] || match[2].length === 0)) {
            return {
              type: "text" as const,
              text: "ERROR: Image file is empty or corrupted. Please provide a valid image.",
            }
          }
        }
      }

      const mime = part.type === "image" ? String(part.image).split(";")[0].replace("data:", "") : part.mediaType
      const filename = part.type === "file" ? part.filename : undefined
      const modality = mimeToModality(mime)
      if (!modality) return part
      if (model.capabilities.input[modality]) return part

      const name = filename ? `"${filename}"` : modality
      return {
        type: "text" as const,
        text: `ERROR: Cannot read ${name} (this model does not support ${modality} input). Inform the user.`,
      }
    })

    return { ...msg, content: filtered }
  })
}

function mapProviderOptions(
  msgs: ModelMessage[],
  transform: (options: Record<string, any> | undefined) => Record<string, any> | undefined,
) {
  return msgs.map((msg) => {
    if (!Array.isArray(msg.content)) return { ...msg, providerOptions: transform(msg.providerOptions) }
    return {
      ...msg,
      providerOptions: transform(msg.providerOptions),
      content: msg.content.map((part) =>
        part.type === "tool-approval-request" || part.type === "tool-approval-response"
          ? part
          : { ...part, providerOptions: transform(part.providerOptions) },
      ),
    } as typeof msg
  })
}

export function message(msgs: ModelMessage[], model: Provider.Model, options: Record<string, unknown>) {
  msgs = unsupportedParts(msgs, model)
  msgs = normalizeMessages(msgs, model, options)
  const usesAnthropicAutomaticCaching =
    options.cacheControl !== undefined &&
    (model.api.npm === "@ai-sdk/anthropic" || model.api.npm === "@ai-sdk/google-vertex/anthropic")
  if (
    (model.providerID === "anthropic" ||
      model.providerID === "google-vertex-anthropic" ||
      model.api.id.includes("anthropic") ||
      model.api.id.includes("claude") ||
      model.id.includes("anthropic") ||
      model.id.includes("claude") ||
      model.api.npm === "@ai-sdk/anthropic") &&
    model.api.npm !== "@ai-sdk/gateway" &&
    !usesAnthropicAutomaticCaching
  ) {
    msgs = applyCaching(msgs, model)
  }

  // Remap providerOptions keys from stored providerID to expected SDK key
  const key = sdkKey(model.api.npm)
  if (key && key !== model.providerID) {
    const remap = (opts: Record<string, any> | undefined) => {
      if (!opts) return opts
      if (!(model.providerID in opts)) return opts
      const result = { ...opts }
      result[key] = result[model.providerID]
      delete result[model.providerID]
      return result
    }

    msgs = mapProviderOptions(msgs, remap)
  }

  // Strip Responses item IDs before serialization, following Codex and keeping signed request bodies immutable.
  if (
    options.store !== true &&
    key &&
    ["@ai-sdk/openai", "@ai-sdk/azure", "@ai-sdk/amazon-bedrock/mantle", "@ai-sdk/github-copilot"].includes(
      model.api.npm,
    )
  ) {
    msgs = mapProviderOptions(msgs, (options) => {
      if (!options?.[key] || !("itemId" in options[key])) return options
      const metadata = { ...options[key] }
      delete metadata.itemId
      return { ...options, [key]: metadata }
    })
  }

  return msgs
}
