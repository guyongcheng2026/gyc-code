import { PermissionV1 } from "@gyccode/core/v1/permission"
import type { Auth } from "@/auth"
import { SessionV1 } from "@gyccode/core/v1/session"
import type { RuntimeFlags } from "@/effect/runtime-flags"
import { InstanceState } from "@/effect/instance-state"
import { Permission } from "@/permission"
import type { Agent } from "@/agent/agent"
import type { MessageV2 } from "../message-v2"
import type { Provider } from "@/provider/provider"
import { ProviderTransform } from "@/provider/transform"
import { context1MHeader, isAnthropicLike } from "./context-1m"
import { contextManagementBetaHeader, contextManagementOptions, type ContextManagementConfig } from "./context-management"
import { SystemPrompt } from "../system"
import { InstallationVersion } from "@gyccode/core/installation/version"
import { Effect, Record } from "effect"
import { jsonSchema, tool as aiTool, type ModelMessage, type Tool } from "ai"
import type { Plugin } from "@/plugin"
import { mergeDeep } from "remeda"

const USER_AGENT = `gyccode/${InstallationVersion}`

type PrepareInput = {
  readonly user: SessionV1.User
  readonly sessionID: string
  readonly parentSessionID?: string
  readonly model: Provider.Model
  readonly agent: Agent.Info
  readonly permission?: PermissionV1.Ruleset
  readonly system: string[]
  readonly messages: ModelMessage[]
  readonly small?: boolean
  readonly tools: Record<string, Tool>
  readonly provider: Provider.Info
  readonly auth: Auth.Info | undefined
  readonly plugin: Plugin.Interface
  readonly flags: RuntimeFlags.Info
  readonly isWorkflow: boolean
  readonly language?: string
  /**
   * Effective max output token cap for this request: runtime flag
   * (`GYCCODE_EXPERIMENTAL_OUTPUT_TOKEN_MAX`) merged with the config
   * `llm.output_token_max` value before the escalate override applies.
   */
  readonly outputTokenMax?: number
  /** Override the max output tokens for this request (e.g. 64k escalate on output-length truncation). */
  readonly maxOutputTokensOverride?: number
  /**
   * API-native context management (Anthropic `context-management` beta): when
   * enabled on an Anthropic-lineage provider, prepare merges the beta header
   * and attaches the `context_management` request options so the API clears
   * old thinking blocks / tool uses server-side.
   */
  readonly apiContextManagement?: ContextManagementConfig
  /** Optional thinking budget (tokens) injected into Anthropic-style variants. */
  readonly thinkingBudgetTokens?: number
}

export type Prepared = {
  readonly system: string[]
  readonly messages: ModelMessage[]
  readonly tools: Record<string, Tool>
  readonly params: {
    readonly temperature?: number
    readonly topP?: number
    readonly topK?: number
    readonly maxOutputTokens?: number
    readonly options: Record<string, any>
  }
  readonly messageTransformOptions: Record<string, any>
  readonly headers: Record<string, string>
}

/**
 * Resolve the response language directive injected into the system prompt.
 * Only Simplified Chinese (zh-CN) and English are supported; any other
 * language falls back to Simplified Chinese (the default).
 */
const SIMPLIFIED_CHINESE_DIRECTIVE =
  "Always respond in Simplified Chinese (zh-CN). \u59cb\u7ec8\u4f7f\u7528\u7b80\u4f53\u4e2d\u6587\u56de\u590d\u7528\u6237\uff0c\u9664\u975e\u7528\u6237\u660e\u786e\u8981\u6c42\u4f7f\u7528\u5176\u4ed6\u8bed\u8a00\u3002"
export function languageDirective(language: string | undefined): string | undefined {
  const resolved = language ?? process.env.GYCCODE_LANGUAGE ?? "zh-CN"
  const normalized = resolved.toLowerCase()
  if (normalized === "zh-cn" || normalized === "zh" || normalized === "zh-hans" || normalized === "zh-sg") {
    return SIMPLIFIED_CHINESE_DIRECTIVE
  }
  if (normalized === "en" || normalized === "en-us" || normalized === "en-gb") {
    return "Always respond in English."
  }
  return SIMPLIFIED_CHINESE_DIRECTIVE
}

const mergeOptions = (target: Record<string, any>, source: Record<string, any> | undefined): Record<string, any> =>
  mergeDeep(target, source ?? {}) as Record<string, any>

/**
 * Assemble the system prompt array from agent prompt, system strings, and user system.
 * Applies plugin transform and collapses multi-segment prompts when possible.
 */
const assembleSystemPrompt = Effect.fn("LLMRequestPrep.assembleSystemPrompt")(function* (
  input: Pick<PrepareInput, "agent" | "system" | "user" | "sessionID" | "model" | "plugin" | "language">,
) {
  const system = [
    [
      ...(input.agent.prompt ? [input.agent.prompt] : SystemPrompt.provider(input.model)),
      languageDirective(input.language),
      ...input.system,
      ...(input.user.system ? [input.user.system] : []),
    ]
      .filter((x) => x)
      .join("\n"),
  ]

  const header = system[0]
  yield* input.plugin.trigger(
    "experimental.chat.system.transform",
    { sessionID: input.sessionID, model: input.model },
    { system },
  )
  if (system.length > 2 && system[0] === header) {
    const rest = system.slice(1)
    system.length = 0
    system.push(header, rest.join("\n"))
  }
  return system
})

/**
 * Resolve provider-specific options by merging base, model, agent, and variant options.
 * Handles Azure completion-URL cleanup and DeepSeek API key injection.
 */
const resolveProviderOptions = Effect.fn("LLMRequestPrep.resolveProviderOptions")(
  function* (
    input: Pick<PrepareInput, "small" | "model" | "sessionID" | "provider" | "agent" | "user" | "auth" | "thinkingBudgetTokens">,
    system: string[],
  ) {
    const isOpenaiOauth = input.provider.id === "openai" && input.auth?.type === "oauth"
    const isDeepSeek = input.provider.id === "deepseek"
    // GycCode 云模型网关等 API 不接受 messages 中的 system role，要求使用 instructions 顶层字段。
    // 通过 provider 配置 options.useInstructions 开启（见 gyccode.json 的 provider 配置）。
    const useInstructions = isOpenaiOauth || isDeepSeek || input.provider.options?.["useInstructions"] === true

    const variant =
      !input.small && input.model.variants && input.user.model.variant
        ? input.model.variants[input.user.model.variant]
        : {}

    // Inject thinking budget from config if configured
    const thinkingBudget = input.thinkingBudgetTokens
    if (thinkingBudget && variant && typeof variant === "object") {
      // Inject budget into Anthropic-style thinking variants
      for (const key of Object.keys(variant)) {
        const v = variant[key]
        if (v && typeof v === "object" && v.thinking && typeof v.thinking === "object") {
          if (v.thinking.type === "enabled" || v.thinking.type === "adaptive") {
            v.thinking.budget_tokens = thinkingBudget
          }
        }
        // Also handle reasoning effort variants that might have budget
        if (v && typeof v === "object" && v.reasoningConfig && typeof v.reasoningConfig === "object") {
          v.reasoningConfig.budgetTokens = thinkingBudget
        }
      }
    }

    const base = input.small
      ? ProviderTransform.smallOptions(input.model)
      : ProviderTransform.options({
          model: input.model,
          sessionID: input.sessionID,
          providerOptions: input.provider.options,
        })
    const options = mergeOptions(mergeOptions(mergeOptions(base, input.model.options), input.agent.options), variant)
    if (
      input.model.api.npm === "@ai-sdk/azure" &&
      (input.provider.options.useCompletionUrls || input.model.options.useCompletionUrls || options.useCompletionUrls)
    ) {
      delete options.reasoningSummary
      delete options.include
    }
    if (useInstructions) {
      options.instructions = system.join("\n")
      delete options.useInstructions
    }
    if (isDeepSeek && !options.apiKey) {
      const deepseekKey = process.env.DEEPSEEK_API_KEY
      if (deepseekKey) options.apiKey = deepseekKey
    }
    return { options, isOpenaiOauth, isDeepSeek, useInstructions }
  }
)

/**
 * Resolve the max output tokens for a request. A caller-supplied override (e.g.
 * the escalate cap on output-length truncation) wins but is still bounded by
 * the model's output limit; otherwise fall back to the provider/model computed
 * cap honoring the configured outputTokenMax.
 */
export function resolveMaxOutputTokens(
  model: Provider.Model,
  outputTokenMax: number | undefined,
  override: number | undefined,
): number {
  if (override !== undefined) return Math.min(model.limit.output, override)
  return ProviderTransform.maxOutputTokens(model, outputTokenMax)
}

export const prepare = Effect.fn("LLMRequestPrep.prepare")(function* (input: PrepareInput) {
  const system = yield* assembleSystemPrompt(input)
  const { options, isOpenaiOauth, isDeepSeek, useInstructions } = yield* resolveProviderOptions(input, system)

  const messages =
    isOpenaiOauth || isDeepSeek || useInstructions || input.isWorkflow
      ? input.messages
      : [
          ...system.map(
            (x): ModelMessage => ({
              role: "system",
              content: x,
            }),
          ),
          ...input.messages,
        ]

  const params = yield* input.plugin.trigger(
    "chat.params",
    {
      sessionID: input.sessionID,
      agent: input.agent.name,
      model: input.model,
      provider: input.provider,
      message: input.user,
    },
    {
      temperature: input.model.capabilities.temperature
        ? (input.agent.temperature ?? ProviderTransform.temperature(input.model))
        : undefined,
      topP: input.agent.topP ?? ProviderTransform.topP(input.model),
      topK: ProviderTransform.topK(input.model),
      maxOutputTokens: resolveMaxOutputTokens(
        input.model,
        input.outputTokenMax ?? input.flags.outputTokenMax,
        input.maxOutputTokensOverride,
      ),
      options,
    },
  )

  const { headers } = yield* input.plugin.trigger(
    "chat.headers",
    {
      sessionID: input.sessionID,
      agent: input.agent.name,
      model: input.model,
      provider: input.provider,
      message: input.user,
    },
    {
      headers: {},
    },
  )

  const tools = resolveTools(input)
  // Codex parity: OpenAI Responses-family providers hardcode `strict: false`
  // on every function tool so MCP-sourced and dynamic schemas that don't
  // satisfy OpenAI's structured-outputs constraints still register.
  if (
    input.model.api.npm === "@ai-sdk/openai" ||
    input.model.api.npm === "@ai-sdk/azure" ||
    input.model.api.npm === "@ai-sdk/amazon-bedrock/mantle"
  ) {
    for (const key of Object.keys(tools)) tools[key] = { ...tools[key], strict: false } as Tool
  }
  if (
    input.model.providerID.includes("github-copilot") &&
    Object.keys(tools).length === 0 &&
    hasToolCalls(input.messages)
  ) {
    // Copilot needs a tools field when replaying prior tool calls, even if no tools are currently enabled.
    tools["_noop"] = aiTool({
      description: "Do not call this tool. It exists only for API compatibility and must never be invoked.",
      inputSchema: jsonSchema({
        type: "object",
        properties: {
          reason: { type: "string", description: "Unused" },
        },
      }),
      execute: async () => ({ output: "", title: "", metadata: {} }),
    })
  }

  const gyccodeProjectID = input.model.providerID.startsWith("gyccode")
    ? (yield* InstanceState.context).project.id
    : undefined

  const mergedHeaders: Record<string, string> = {
    ...(input.model.providerID.startsWith("gyccode")
      ? {
          ...(gyccodeProjectID ? { "x-gyccode-project": gyccodeProjectID } : {}),
          "x-gyccode-session": input.sessionID,
          "x-gyccode-request": input.user.id,
          "x-gyccode-client": input.flags.client,
          "User-Agent": USER_AGENT,
        }
      : {
          "x-session-affinity": input.sessionID,
          "X-Session-Id": input.sessionID,
          ...(input.parentSessionID ? { "x-parent-session-id": input.parentSessionID } : {}),
          "User-Agent": USER_AGENT,
        }),
    ...input.model.headers,
    ...headers,
  }
  // 1M-context beta header: models.dev advertises a 1M window (context=1,000,000)
  // but the Anthropic API only honors it when `context-1m-2025-08-07` is sent.
  // Merge (comma) into any existing anthropic-beta so static betas like
  // interleaved-thinking are preserved, never overwritten.
  const context1M = context1MHeader(input.model, mergedHeaders["anthropic-beta"])
  if (context1M !== undefined) mergedHeaders["anthropic-beta"] = context1M

  // API-native context management: when configured and the provider is
  // Anthropic-lineage, merge the context-management beta header and attach
  // the AI SDK providerOptions `contextManagement` (camelCase) so the API
  // clears old thinking blocks / tool uses server-side. ProviderTransform
  // wraps params.options under the SDK key (e.g. `anthropic`) downstream, so
  // the AI SDK zod reads it from providerOptions.anthropic.contextManagement
  // and the native path maps the same key into the raw body parameter.
  // The header merge and the options attach share one gate: only when
  // `contextManagementOptions` yields non-empty edits (both clears disabled =>
  // no edits => no header, no options) do we touch the request.
  if (input.apiContextManagement?.enabled && isAnthropicLike(input.model)) {
    const options = contextManagementOptions(input.apiContextManagement)
    if (options) {
      // `contextManagementBetaHeader(x, true, true)` always merges (returns a
      // string); the undefined branch is unreachable but keeps TS narrowing.
      const beta = contextManagementBetaHeader(mergedHeaders["anthropic-beta"], true, true)
      if (beta !== undefined) mergedHeaders["anthropic-beta"] = beta
      params.options = { ...params.options, ...options }
    }
  }

  return {
    system,
    messages,
    tools: Object.fromEntries(Object.entries(tools).toSorted(([a], [b]) => a.localeCompare(b))),
    params,
    messageTransformOptions: options,
    headers: mergedHeaders,
  }
})

/**
 * Resolve available tools by filtering out permission-disabled and user-disabled tools.
 * Tool resolution is synchronous: Permission.disabled merges agent + session rulesets,
 * and user.tools provides per-tool opt-out. Returns a filtered copy of the input tools.
 */
function resolveTools(input: Pick<PrepareInput, "tools" | "agent" | "permission" | "user">) {
  const disabled = Permission.disabled(
    Object.keys(input.tools),
    Permission.merge(input.agent.permission, input.permission ?? []),
  )
  return Record.filter(input.tools, (_, k) => input.user.tools?.[k] !== false && !disabled.has(k))
}

export function hasToolCalls(messages: ModelMessage[]): boolean {
  for (const msg of messages) {
    if (!Array.isArray(msg.content)) continue
    for (const part of msg.content) {
      if (part.type === "tool-call" || part.type === "tool-result") return true
    }
  }
  return false
}

export * as LLMRequestPrep from "./request"
