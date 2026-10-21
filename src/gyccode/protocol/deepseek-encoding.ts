import type { Conversation, ContentPart, ResponseFormat, ThinkingConfig } from "./conversation"
import { getDeepseekTokenizer } from "@core/util/deepseek-tokenizer"

export interface RenderedPrompt {
  readonly system: string
  readonly prompt: string
  readonly tokenHint?: number
}

function renderContentPart(part: ContentPart): string {
  switch (part.type) {
    case "text":
      return part.text
    case "image":
      return part.data ? `[image:${part.mimeType ?? "image"}]` : `[image:${part.uri ?? "image"}]`
    case "tool_call":
      return `[tool_call:${part.name}]${JSON.stringify(part.input)}`
    case "tool_result":
      return `[tool_result:${part.toolCallId}]${JSON.stringify(part.output)}`
    case "reasoning":
      return `[thinking]${part.text}[/thinking]`
    default:
      return String(part)
  }
}

function renderMessageContent(parts: readonly ContentPart[]): string {
  return parts.map(renderContentPart).join("")
}

function buildThinkingInstruction(thinking: ThinkingConfig): string {
  const effort = thinking.effort ? ` effort=${thinking.effort}` : ""
  const budget = thinking.budgetTokens ? ` budget=${thinking.budgetTokens}` : ""
  return `Thinking mode: ${thinking.mode}${effort}${budget}. Think before answering when the mode is enabled or adaptive.`
}

function buildStructureConstraint(format: ResponseFormat): string {
  switch (format.type) {
    case "json_schema":
      return `Structured output: you MUST output valid JSON matching the provided schema. Do NOT output plain text.`
    case "regex":
      return `Structured output: you MUST output text matching the following regex: ${format.pattern}`
    case "ebnf":
      return `Structured output: you MUST output text conforming to the following EBNF grammar:\n${format.grammar}`
    default:
      return ""
  }
}

/**
 * DeepSeek V4/V4.1 对话 Prompt 渲染器。
 * 将 `Conversation` 中间表示渲染为 DeepSeek 专属 Prompt 字符串，可独立于会话循环复用。
 * 渲染器只负责对话本体的 Prompt 组装；日期/记忆/画像注入保持在会话层（prompt.ts），
 * 渲染器接收已注入好的 `Conversation`。
 */
export class DeepseekV41Encoding {
  renderConversation(conversation: Conversation): RenderedPrompt {
    const parts: string[] = []
    let system = ""

    for (const msg of conversation.messages) {
      const content = renderMessageContent(msg.content)
      if (msg.role === "system") {
        system = content
      } else if (msg.role === "user") {
        parts.push(`user\n${content}`)
      } else if (msg.role === "assistant") {
        parts.push(`assistant\n${content}`)
      } else if (msg.role === "tool") {
        parts.push(`tool\n${content}`)
      }
    }

    // Thinking mode 指令注入到 system 段（DeepSeek V4.1 支持思考模式）。
    if (conversation.thinking && conversation.thinking.mode !== "disabled") {
      const thinkingInstruction = buildThinkingInstruction(conversation.thinking)
      system = system ? `${system}\n\n${thinkingInstruction}` : thinkingInstruction
    }

    // 结构化输出约束（json_schema/regex/ebnf）注入到 system 段。
    if (conversation.format && conversation.format.type !== "text") {
      const constraint = buildStructureConstraint(conversation.format)
      system = system ? `${system}\n\n${constraint}` : constraint
    }

    // 日志概率请求：当 logprobs 为 true 时，在 system 段请求模型逐 token 返回概率。
    if (conversation.logprobs === true) {
      const top = conversation.topLogprobs !== undefined ? ` top_logprobs=${conversation.topLogprobs}` : ""
      const logprobInstruction = `Logprobs: return per-token log probabilities${top}.`
      system = system ? `${system}\n\n${logprobInstruction}` : logprobInstruction
    }

    const systemSection = system ? `system\n${system}\n\n` : ""
    const prompt = `${systemSection}${parts.join("\n\n")}\n\nassistant\n`

    return { system, prompt }
  }

  /**
   * 对话 → DeepSeek token ID 数组，并分离 reasoning 段单独计数。
   * 用于精确的 token 预算与 `reasoning_tokens` 上报。
   */
  encodeConversation(conversation: Conversation): { promptIds: number[]; reasoningTokenCount: number } {
    const tokenizer = getDeepseekTokenizer()
    let promptText = ""
    let reasoningText = ""
    for (const msg of conversation.messages) {
      for (const part of msg.content) {
        if (part.type === "reasoning") {
          reasoningText += part.text
        } else {
          promptText += renderContentPart(part)
        }
      }
    }
    return {
      promptIds: tokenizer.encode(promptText),
      reasoningTokenCount: tokenizer.count(reasoningText),
    }
  }
}
