// gyc cli LLM 接入层 —— 直接复用 gyc TUI 的 LLM 基础设施（@gyccode/llm 工作区包）：
//   - 同一套协议栈：openai-compatible 协议 + RequestExecutor（自动重试 / 错误结构化 / 敏感信息脱敏）
//   - 同一份凭据来源：gyc auth.json（~/.local/share/gyccode/auth.json）
//   - 同一 provider facade：OpenAICompatible（默认 deepseek，https://api.deepseek.com/v1）
// 环境变量：GYC_PROVIDER / GYC_MODEL（支持 "provider/model" 写法），缺省 deepseek/deepseek-chat

import * as fs from "node:fs"
import * as os from "node:os"
import * as path from "node:path"
import { Effect, Layer } from "effect"
import {
  LLM,
  Message,
  ToolCallPart,
  ToolDefinition,
  ToolResultPart,
  type LLMResponse,
  type Model,
} from "@gyccode/llm"
import { LLMClient, RequestExecutor } from "@gyccode/llm/route"
import { OpenAICompatible } from "@gyccode/llm/providers"
import type { ContentBlock, LlmResponse, Message as ChatMessage } from "./types"

export type LlmConfig = {
  provider: string
  model: string
  apiKey: string
  /** 自定义 provider 的 API 地址（来自 gyc gyccode.json；内置 profile 无需配置） */
  baseURL: string | undefined
  maxTokens: number
}

type AuthFile = Record<string, { type?: string; key?: string }>
type ConfigFile = { provider?: Record<string, { api?: string }> }

/** gyc 全局数据目录（与 gyc TUI Global.Path.data 同规则：$XDG_DATA_HOME 或 ~/.local/share） */
function gycDataDir(): string {
  const base = process.env.XDG_DATA_HOME ?? path.join(os.homedir(), ".local", "share")
  return path.join(base, "gyccode")
}

/** gyc 全局配置目录（与 gyc TUI Global.Path.config 同规则：$XDG_CONFIG_HOME 或 ~/.config） */
function gycConfigDir(): string {
  const base = process.env.XDG_CONFIG_HOME ?? path.join(os.homedir(), ".config")
  return path.join(base, "gyccode")
}

function readJson<T>(file: string): T | undefined {
  try {
    return JSON.parse(fs.readFileSync(file, "utf8")) as T
  } catch {
    return undefined
  }
}

/** 从 gyc auth.json 读取指定 provider 的 API key（与 gyc TUI 共用同一份凭据） */
function loadApiKey(provider: string): string | undefined {
  const entry = readJson<AuthFile>(path.join(gycDataDir(), "auth.json"))?.[provider]
  const key = entry?.key
  return typeof key === "string" && key.length > 0 ? key : undefined
}

/** 从 gyc gyccode.json 读取自定义 provider 的 API 地址 */
function loadProviderBaseURL(provider: string): string | undefined {
  const api = readJson<ConfigFile>(path.join(gycConfigDir(), "gyccode.json"))?.provider?.[provider]?.api
  return typeof api === "string" && api.length > 0 ? api.replace(/\/$/, "") : undefined
}

export function loadLlmConfig(): LlmConfig {
  const raw = process.env.GYC_MODEL ?? "deepseek-chat"
  const slash = raw.indexOf("/")
  const provider = process.env.GYC_PROVIDER ?? (slash > 0 ? raw.slice(0, slash) : "deepseek")
  const model = slash > 0 ? raw.slice(slash + 1) : raw
  const apiKey = loadApiKey(provider) ?? process.env.GYC_API_KEY
  if (!apiKey) {
    throw new Error(`gyc cli 缺少 ${provider} 凭据：请在 gyc 中登录该 provider，或设置 GYC_API_KEY`)
  }
  return {
    provider,
    model,
    apiKey,
    baseURL: loadProviderBaseURL(provider),
    maxTokens: 8192,
  }
}

function buildModel(config: LlmConfig): Model {
  if (config.provider === "deepseek") {
    return OpenAICompatible.deepseek.configure({ apiKey: config.apiKey }).model(config.model)
  }
  if (!config.baseURL) {
    throw new Error(`gyc cli：provider "${config.provider}" 缺少 API 地址（gyccode.json → provider.${config.provider}.api）`)
  }
  return OpenAICompatible.configure({
    provider: config.provider,
    baseURL: config.baseURL,
    apiKey: config.apiKey,
  }).model(config.model)
}

// LLMClient（协议编译 + HTTP 执行 + 重试）由 fetch 层驱动，与会话内其他调用方共享同一实现
const clientLayer = LLMClient.layer.pipe(Layer.provide(RequestExecutor.fetchLayer))

/** gyc cli 消息格式 → @gyccode/llm 消息（tool_result 走独立 tool 角色消息） */
function toGycMessages(messages: ChatMessage[]): Message[] {
  const toolNames = new Map<string, string>()
  for (const msg of messages) {
    if (typeof msg.content === "string") continue
    for (const block of msg.content) {
      if (block.type === "tool_use") toolNames.set(block.id, block.name)
    }
  }
  const out: Message[] = []
  for (const msg of messages) {
    const blocks: ContentBlock[] =
      typeof msg.content === "string" ? [{ type: "text", text: msg.content }] : msg.content
    if (msg.role === "assistant") {
      out.push(
        Message.assistant(
          blocks.flatMap(block => {
            if (block.type === "tool_use") {
              return [ToolCallPart.make({ id: block.id, name: block.name, input: block.input })]
            }
            return block.type === "text" ? [Message.text(block.text)] : []
          }),
        ),
      )
      continue
    }
    // user 角色：tool 结果必须紧跟 assistant 的 tool_calls，之后才是普通文本
    const texts: string[] = []
    for (const block of blocks) {
      if (block.type === "text") {
        texts.push(block.text)
        continue
      }
      if (block.type === "tool_result") {
        out.push(
          Message.tool(
            ToolResultPart.make({
              id: block.tool_use_id,
              name: toolNames.get(block.tool_use_id) ?? "tool",
              result: block.content,
              resultType: block.is_error === true ? "error" : "text",
            }),
          ),
        )
      }
    }
    if (texts.length > 0) out.push(Message.user(texts.join("\n")))
  }
  return out
}

function toStopReason(reason: LLMResponse["finishReason"]): string | null {
  if (reason === "tool-calls") return "tool_use"
  if (reason === "stop") return "end_turn"
  if (reason === "length") return "max_tokens"
  return reason
}

function fromGycResponse(response: LLMResponse): LlmResponse {
  const content: ContentBlock[] = []
  if (response.text.length > 0) content.push({ type: "text", text: response.text })
  for (const call of response.toolCalls) {
    content.push({
      type: "tool_use",
      id: call.id,
      name: call.name,
      input: (call.input ?? {}) as Record<string, unknown>,
    })
  }
  return {
    role: "assistant",
    content,
    stop_reason: toStopReason(response.finishReason),
    usage: {
      input_tokens: response.usage?.inputTokens ?? 0,
      output_tokens: response.usage?.outputTokens ?? 0,
    },
  }
}

export type ApiToolSchema = {
  name: string
  description: string
  input_schema: {
    type: "object"
    properties: Record<string, unknown>
    required: string[]
  }
}

export async function callLlm(params: {
  config: LlmConfig
  system: string
  messages: ChatMessage[]
  tools: ApiToolSchema[]
}): Promise<LlmResponse> {
  const request = LLM.request({
    model: buildModel(params.config),
    system: params.system,
    messages: toGycMessages(params.messages),
    tools: params.tools.map(tool => ({
      name: tool.name,
      description: tool.description,
      inputSchema: tool.input_schema,
    })),
    generation: { maxTokens: params.config.maxTokens },
  })
  const response = await Effect.runPromise(
    LLMClient.generate(request).pipe(Effect.provide(clientLayer)),
  )
  return fromGycResponse(response)
}

type Usage = LlmResponse["usage"]

export function emptyUsage(): Usage {
  return { input_tokens: 0, output_tokens: 0 }
}

export function accumulateUsage(total: Usage, add: Usage): void {
  total.input_tokens += add.input_tokens
  total.output_tokens += add.output_tokens
}
