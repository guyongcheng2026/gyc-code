import { LayerNode } from "@gyccode/core/effect/layer-node"
import { SessionV1 } from "@gyccode/core/v1/session"
import { ConfigV1 } from "@gyccode/core/v1/config/config"
import { Session } from "./session"
import { SessionID, MessageID, PartID } from "./schema"
import { Provider } from "@/provider/provider"
import { MessageV2 } from "./message-v2"
import { Token, estimateWithAPI } from "@/util/token"
import { SessionProcessor } from "./processor"
import { Agent } from "@/agent/agent"
import { Plugin } from "@/plugin"
import { Config } from "@/config/config"
import { NotFoundError } from "@/storage/storage"

import { Effect, Layer, Context } from "effect"
import { InstanceState } from "@/effect/instance-state"
import { isOverflow as overflow, usable } from "./overflow"
import { serviceUse } from "@gyccode/core/effect/service-use"
import { RuntimeFlags } from "@/effect/runtime-flags"
import { EventV2Bridge } from "@/event-v2-bridge"
import { ProviderV2 } from "@gyccode/core/provider"
import { ModelV2 } from "@gyccode/core/model"
import { buildPrompt } from "@gyccode/core/session/compaction"
import { SessionCompactionEvent } from "@gyccode/schema/session-compaction-event"
import {
  selectMicrocompactParts,
  selectTimeBasedParts,
  shouldContinueAfterMicrocompact,
} from "./microcompact-select"
import { resolveOutputTokenMax } from "./llm/output-cap"
import { isAnthropicLike } from "./llm/context-1m"
import { readMemories, stripKeyHeader, type MemoryEntry } from "../memory/memory-bridge"

export const Event = SessionCompactionEvent

export const PRUNE_MINIMUM = 20_000
export const PRUNE_PROTECT = 40_000
const TOOL_OUTPUT_MAX_CHARS = 2_000
const PRUNE_PROTECTED_TOOLS = ["skill"]
const DEFAULT_TAIL_TURNS = 2
const MIN_PRESERVE_RECENT_TOKENS = 2_000
const MAX_PRESERVE_RECENT_TOKENS = 8_000

// --- Microcompact ---
export const MICROCOMPACT_THRESHOLD = 0.9 // Start microcompact at 90% context usage
export const CACHE_PREFIX_KEEP = 20 // Keep first 20 messages for cache preservation
export const MAX_CONSECUTIVE_COMPACTION_FAILURES = 3 // Auto-compaction circuit breaker

export interface MicrocompactBlock {
  index: number
  content: string
  expired: boolean
}

/** Simple message type for microcompact operations */
interface Message {
  role: string
  content: string
}

export function microcompact(
  messages: readonly Message[],
  contextUsed: number,
  contextLimit: number,
): readonly Message[] {
  const ratio = contextUsed / contextLimit
  if (ratio < MICROCOMPACT_THRESHOLD) return messages

  // Keep cache prefix intact, mark middle blocks as expired
  const result: Message[] = []
  for (let i = 0; i < messages.length; i++) {
    if (i < CACHE_PREFIX_KEEP || i >= messages.length - 5) {
      // Keep cache prefix and recent messages
      result.push(messages[i])
    } else if (messages[i].role === "tool") {
      // Mark expired tool outputs
      result.push({
        ...messages[i],
        content: "[This tool output has been compacted. The result was processed in earlier context.]",
      })
    } else {
      result.push(messages[i])
    }
  }
  return result
}

export interface PivotSelection {
  head: SessionV1.WithParts[]
  tail_start_id: MessageID
}

/** Select pivot-based partial compaction (up_to direction): compact everything
 * before the pivot message and keep the pivot plus everything after it. Returns
 * undefined when the pivot is missing or is the first message (nothing to
 * compact before it), so callers fall back to standard tail-turns selection. */
export function pivotTail(
  messages: readonly SessionV1.WithParts[],
  pivotMessageID: MessageID,
): PivotSelection | undefined {
  const pivotIndex = messages.findIndex((m) => m.info.id === pivotMessageID)
  if (pivotIndex <= 0) return undefined
  return {
    head: messages.slice(0, pivotIndex),
    tail_start_id: messages[pivotIndex]!.info.id,
  }
}

/**
 * Usage-anchored estimation (mirrors reference agent tokenCountWithEstimation).
 *
 * Walks backwards to find the last assistant message whose final step-finish
 * part carries real API usage. The anchor is the total context sent to the
 * model at that step (input + cache.read + cache.write) plus the tokens it
 * generated (output + reasoning), which become part of the next request's
 * input. Everything after the anchor is returned for local estimation.
 *
 * Only valid for a full conversation list (not a subset), since the anchor
 * measures cumulative context up to that step.
 */
export function findUsageAnchor(messages: SessionV1.WithParts[]): {
  anchorTokens: number
  toEstimate: SessionV1.WithParts[]
} {
  for (let i = messages.length - 1; i >= 0; i--) {
    const msg = messages[i]
    if (msg.info.role !== "assistant") continue
    const stepFinish = msg.parts.findLast((p): p is SessionV1.StepFinishPart => p.type === "step-finish")
    if (!stepFinish) continue
    const t = stepFinish.tokens
    const contextAtStep = t.input + t.cache.read + t.cache.write
    if (contextAtStep > 0) {
      return {
        anchorTokens: contextAtStep + t.output + t.reasoning,
        toEstimate: messages.slice(i + 1),
      }
    }
  }
  return { anchorTokens: 0, toEstimate: messages }
}

type Turn = {
  start: number
  end: number
  id: MessageID
}

type Tail = {
  start: number
  id: MessageID
}

type CompletedCompaction = {
  userIndex: number
  assistantIndex: number
  summary: string | undefined
}

function summaryText(message: SessionV1.WithParts) {
  const text = message.parts
    .filter((part): part is SessionV1.TextPart => part.type === "text")
    .map((part) => part.text.trim())
    .filter(Boolean)
    .join("\n\n")
    .trim()
  if (!text) return undefined
  // 草稿剥离：若模型输出 <analysis>...</analysis><summary>...</summary>，只保留 <summary> 内容
  const summary = text.match(/<summary>([\s\S]*)<\/summary>/)
  const cleaned = (summary ? summary[1]! : text).trim()
  return cleaned || undefined
}

/** 剥离 memory 记忆写入时残留的 "#memory_<key>" 首行，只保留实际内容。 */
export function cleanMemoryValue(value: string): string {
  return stripKeyHeader(value)
}

/**
 * 会话记忆快速压缩路径（对齐 reference agent trySessionMemoryCompaction）。
 *
 * 用后台已维护的 memory 记忆直接拼装摘要，免去一次完整 LLM 摘要调用。
 * 纯函数：记忆为空时返回 undefined，调用方回退到 LLM 摘要。
 * 输出包裹 <summary> 标签，与 LLM 摘要格式及 summaryText 解析保持一致。
 */
export function buildMemorySummary(
  memories: readonly MemoryEntry[],
  previousSummary?: string,
): string | undefined {
  const cleaned = memories.map((m) => cleanMemoryValue(m.value)).filter(Boolean)
  if (cleaned.length === 0) return undefined
  const memoryLines = cleaned.map((line) => `- ${line}`).join("\n")
  const parts: string[] = []
  if (previousSummary) parts.push(`Previous context:\n${previousSummary}`)
  parts.push(`Key facts and decisions captured so far:\n${memoryLines}`)
  return `<summary>\n${parts.join("\n\n")}\n</summary>`
}

function completedCompactions(messages: SessionV1.WithParts[]) {
  const users = new Map<MessageID, number>()
  for (let i = 0; i < messages.length; i++) {
    const msg = messages[i]
    if (msg.info.role !== "user") continue
    if (!msg.parts.some((part) => part.type === "compaction")) continue
    users.set(msg.info.id, i)
  }

  return messages.flatMap((msg, assistantIndex): CompletedCompaction[] => {
    if (msg.info.role !== "assistant") return []
    if (!msg.info.summary || !msg.info.finish || msg.info.error) return []
    const userIndex = users.get(msg.info.parentID)
    if (userIndex === undefined) return []
    return [{ userIndex, assistantIndex, summary: summaryText(msg) }]
  })
}

/**
 * 统计历史尾部连续失败的自动压缩次数：
 * 一条压缩尝试（带 compaction part 的 user 消息）若其后没有成功产出 summary 的 assistant 消息，记为失败。
 * 用于熔断：连续失败达到上限后停止自动压缩，避免每轮白烧 API。
 */
export function consecutiveCompactionFailures(messages: SessionV1.WithParts[]) {
  const successful = new Set(completedCompactions(messages).map((item) => messages[item.userIndex]?.info.id))
  let failures = 0
  for (let i = messages.length - 1; i >= 0; i--) {
    const msg = messages[i]
    if (msg.info.role !== "user" || !msg.parts.some((part) => part.type === "compaction")) continue
    if (successful.has(msg.info.id)) break
    failures += 1
  }
  return failures
}

function preserveRecentBudget(input: { cfg: ConfigV1.Info; model: Provider.Model }) {
  return (
    input.cfg.compaction?.preserve_recent_tokens ??
    Math.min(MAX_PRESERVE_RECENT_TOKENS, Math.max(MIN_PRESERVE_RECENT_TOKENS, Math.floor(usable(input) * 0.25)))
  )
}

function turns(messages: SessionV1.WithParts[]) {
  const result: Turn[] = []
  for (let i = 0; i < messages.length; i++) {
    const msg = messages[i]
    if (msg.info.role !== "user") continue
    if (msg.parts.some((part) => part.type === "compaction")) continue
    result.push({
      start: i,
      end: messages.length,
      id: msg.info.id,
    })
  }
  for (let i = 0; i < result.length - 1; i++) {
    result[i].end = result[i + 1].start
  }
  return result
}

function splitTurn(input: {
  messages: SessionV1.WithParts[]
  turn: Turn
  model: Provider.Model
  budget: number
  estimate: (input: { messages: SessionV1.WithParts[]; model: Provider.Model }) => Effect.Effect<number>
}) {
  return Effect.gen(function* () {
    if (input.budget <= 0) return undefined
    if (input.turn.end - input.turn.start <= 1) return undefined
    for (let start = input.turn.start + 1; start < input.turn.end; start++) {
      const message = input.messages[start]
      // Defensive: if turn bounds are ever out of sync with the messages array
      // (e.g. after a reorder), skip instead of asserting on an undefined item.
      if (!message) continue
      const size = yield* input.estimate({
        messages: input.messages.slice(start, input.turn.end),
        model: input.model,
      })
      if (size > input.budget) continue
      return {
        start,
        id: message.info.id,
      } satisfies Tail
    }
    return undefined
  })
}

export interface Interface {
  readonly isOverflow: (input: {
    tokens: SessionV1.Assistant["tokens"]
    model: Provider.Model
  }) => Effect.Effect<boolean>
  readonly microcompactIfNeeded: (input: {
    sessionID: SessionID
    model: Provider.Model
  }) => Effect.Effect<boolean>
  readonly prune: (input: { sessionID: SessionID }) => Effect.Effect<void>
  readonly process: (input: {
    parentID: MessageID
    messages: SessionV1.WithParts[]
    sessionID: SessionID
    auto: boolean
    overflow?: boolean
  }) => Effect.Effect<"continue" | "stop">
  readonly create: (input: {
    sessionID: SessionID
    agent: string
    model: { providerID: ProviderV2.ID; modelID: ModelV2.ID }
    auto: boolean
    overflow?: boolean
    pivot?: MessageID
  }) => Effect.Effect<void>
}

export class Service extends Context.Service<Service, Interface>()("@gyccode/SessionCompaction") {}

export const use = serviceUse(Service)

/**
 * Build an Anthropic countTokens adapter for API-backed token estimation, or
 * throw when no usable base URL / API key is available so callers fall back to
 * the local estimator. POSTs the serialized model messages to the Anthropic
 * Messages `count_tokens` endpoint (guarded by the `count-tokens` beta header)
 * using the model's own base URL and the provider's API key (provider options
 * `apiKey` or the provider `key`). A missing key, a non-Anthropic provider, a
 * network error, an invalid response, or a 10s request timeout all surface as
 * a throw, which `estimateWithAPI` converts into the local fallback.
 *
 * Limitation: the request body reuses the AI-SDK-shaped message array that
 * `estimate` already serialized (JSON round-trip), which is close to but not
 * byte-identical to the Anthropic wire format. Any rejection by the API falls
 * back to the local estimator, so this only affects accuracy, never availability.
 */
function makeCountTokensAdapter(
  model: Provider.Model,
  apiModel: string,
  providerInfo: Provider.Info | undefined,
): { countTokens: (text: string) => Promise<number> } {
  const baseURL = (model.api.url || "").replace(/\/+$/, "")
  const apiKey =
    (typeof providerInfo?.options?.apiKey === "string" && providerInfo.options.apiKey) || providerInfo?.key || undefined
  if (!baseURL || !apiKey) {
    throw new Error(`countTokens: no API key or base URL for ${model.providerID}/${model.api.id}`)
  }
  const url = baseURL.endsWith("/v1") ? `${baseURL}/messages/count_tokens` : `${baseURL}/v1/messages/count_tokens`
  return {
    countTokens: async (text: string) => {
      const messages = JSON.parse(text)
      const res = await fetch(url, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-api-key": apiKey,
          "anthropic-version": "2023-06-01",
          "anthropic-beta": "count-tokens-2025-05-15",
        },
        body: JSON.stringify({ model: apiModel, messages }),
        signal: AbortSignal.timeout(10_000),
      })
      if (!res.ok) throw new Error(`countTokens request failed: ${res.status} ${res.statusText}`)
      const data = (await res.json()) as { input_tokens?: unknown }
      const n = data.input_tokens
      if (typeof n !== "number" || !Number.isInteger(n) || n < 0) {
        throw new Error("countTokens returned an invalid input_tokens value")
      }
      return n
    },
  }
}

const layer = Layer.effect(
  Service,
  Effect.gen(function* () {
    const config = yield* Config.Service
    const session = yield* Session.Service
    const agents = yield* Agent.Service
    const plugin = yield* Plugin.Service
    const processors = yield* SessionProcessor.Service
    const provider = yield* Provider.Service
    const events = yield* EventV2Bridge.Service
    const flags = yield* RuntimeFlags.Service

    const isOverflow = Effect.fn("SessionCompaction.isOverflow")(function* (input: {
      tokens: SessionV1.Assistant["tokens"]
      model: Provider.Model
    }) {
      const cfg = yield* config.get()
      return overflow({
        cfg,
        tokens: input.tokens,
        model: input.model,
        outputTokenMax: resolveOutputTokenMax(flags, cfg),
      })
    })

    // Mark the selected tool outputs as compacted and persist them. Shared by
    // the time-based and usage-based microcompact branches below.
    const markCompacted = Effect.fnUntraced(function* (parts: Array<SessionV1.ToolPart & { _msgIndex: number }>) {
      let changed = false
      for (const part of parts) {
        if (part.state.status === "completed") {
          part.state.time.compacted = Date.now()
          yield* session.updatePart(part)
          changed = true
        }
      }
      if (changed) {
        // Compacting tool outputs invalidates the frozen per-callID truncation
        // decisions: aggregateToolCaps skips compacted parts, so their callIDs
        // leave stale entries behind in the module-level truncationDecisions map
        // (unbounded growth across repeated compactions). Reset so the next
        // serialization re-decides from the post-compaction tool set.
        MessageV2.resetTruncationDecisions()
      }
    })

    const microcompactIfNeeded = Effect.fn("SessionCompaction.microcompactIfNeeded")(function* (input: {
      sessionID: SessionID
      model: Provider.Model
    }) {
      const cfg = yield* config.get()
      if (cfg.compaction?.microcompact === false) return false
      const msgs = yield* session
        .messages({ sessionID: input.sessionID })
        .pipe(Effect.catchIf(NotFoundError.isInstance, () => Effect.succeed(undefined)))
      if (!msgs || msgs.length === 0) return false

      // Time-based trigger first: a long idle gap means the prompt cache
      // expired, so clear old tool results before the request shrinks what gets
      // rewritten. (Aligned with reference agent timeBasedMCConfig, but locally
      // configurable.) Opt-in: only fires when `enabled` is explicitly true
      // (the documented default is false). Falls through to the usage-based
      // check below (chaining).
      const tbm = cfg.compaction?.time_based_microcompact
      let clearedAny = false
      if (tbm?.enabled === true) {
        const tSelected = selectTimeBasedParts(msgs as any, {
          gapMinutes: tbm?.gap_minutes ?? 60,
          keepRecent: tbm?.keep_recent ?? 5,
        })
        if (tSelected.length > 0) {
          yield* Effect.logInfo("microcompacting (time-based)", {
            "session.id": input.sessionID,
            count: tSelected.length,
          })
          yield* markCompacted(tSelected)
          clearedAny = true
        }
      }

      const used = yield* estimate({ messages: msgs, model: input.model, anchored: true })
      const limit = usable({ cfg, model: input.model, outputTokenMax: resolveOutputTokenMax(flags, cfg) })
      const selected = limit > 0 ? selectMicrocompactParts(msgs as any, used, limit) : []
      if (selected.length > 0) {
        yield* Effect.logInfo("microcompacting", {
          "session.id": input.sessionID,
          count: selected.length,
          usage: Math.round((used / limit) * 100),
        })
        yield* markCompacted(selected)
      }
      // Did real work (time-based or usage-based) -> true so the caller
      // continues (overflow was reduced). Nothing cleared -> false so the caller
      // escalates to full compaction instead of busy-looping.
      return shouldContinueAfterMicrocompact(clearedAny, limit > 0, selected.length > 0)
    })
    const estimate = Effect.fn("SessionCompaction.estimate")(function* (input: {
      messages: SessionV1.WithParts[]
      model: Provider.Model
      /** When true, use usage-anchored estimation (only for full conversation). */
      anchored?: boolean
    }) {
      // Usage-anchored estimation (mirrors reference agent tokenCountWithEstimation):
      // find the last assistant message's step-finish part with real API usage as
      // anchor, then only estimate messages after it locally. This avoids O(n)
      // re-serialization of the entire conversation on every check.
      // Only valid when estimating the full conversation (anchored=true).
      const { anchorTokens, toEstimate } = input.anchored
        ? findUsageAnchor(input.messages)
        : { anchorTokens: 0, toEstimate: input.messages }

      if (toEstimate.length === 0) return anchorTokens

      const msgs = yield* MessageV2.toModelMessagesEffect(toEstimate, input.model)
      const text = JSON.stringify(msgs)
      const cfgInfo = yield* config.get()
      const mode = cfgInfo.token_counting?.mode ?? "local"
      if (mode === "local") return anchorTokens + Token.estimate(text)
      // Non-Anthropic providers do not implement the Anthropic count_tokens
      // endpoint; skip straight to the local estimator instead of paying a
      // guaranteed-failing round trip.
      if (!isAnthropicLike(input.model)) return anchorTokens + Token.estimate(text)
      // API-backed counting (mode "api" / "auto"): Anthropic countTokens with a
      // local fallback on any failure (missing key, non-Anthropic provider,
      // network error, invalid response). "auto" is exactly this behavior;
      // "api" keeps the same fallback so a flaky endpoint can never block
      // compaction.
      // api_model defaults to the model's own id when unset.
      const apiModel = cfgInfo.token_counting?.api_model ?? input.model.api.id
      const providerInfo = yield* provider.getProvider(input.model.providerID)
      const count = yield* Effect.tryPromise(() =>
        estimateWithAPI(text, {
          api: makeCountTokensAdapter(input.model, apiModel, providerInfo),
          model: apiModel,
        }),
      ).pipe(Effect.catch(() => Effect.succeed(Token.estimate(text))))
      return anchorTokens + count
    })

    const select = Effect.fn("SessionCompaction.select")(function* (input: {
      messages: SessionV1.WithParts[]
      cfg: ConfigV1.Info
      model: Provider.Model
      pivot?: MessageID
    }) {
      if (input.pivot) {
        const selected = pivotTail(input.messages, input.pivot)
        if (selected) return selected
        yield* Effect.logInfo("compaction: pivot fallback to tail-turns", { "pivot.id": input.pivot })
      }
      const limit = input.cfg.compaction?.tail_turns ?? DEFAULT_TAIL_TURNS
      if (limit <= 0) return { head: input.messages, tail_start_id: undefined }
      const budget = preserveRecentBudget({ cfg: input.cfg, model: input.model })
      const all = turns(input.messages)
      if (!all.length) return { head: input.messages, tail_start_id: undefined }
      const recent = all.slice(-limit)
      const sizes = yield* Effect.forEach(
        recent,
        (turn) =>
          estimate({
            messages: input.messages.slice(turn.start, turn.end),
            model: input.model,
          }),
        { concurrency: 1 },
      )

      let total = 0
      let keep: Tail | undefined
      for (let i = recent.length - 1; i >= 0; i--) {
        const turn = recent[i]!
        const size = sizes[i]
        if (total + size <= budget) {
          total += size
          keep = { start: turn.start, id: turn.id }
          continue
        }
        const remaining = budget - total
        const split = yield* splitTurn({
          messages: input.messages,
          turn,
          model: input.model,
          budget: remaining,
          estimate,
        })
        if (split) keep = split
        else if (!keep) {
          yield* Effect.logInfo("tail fallback", { budget, size, total })
        }
        break
      }

      if (!keep || keep.start === 0) return { head: input.messages, tail_start_id: undefined }
      return {
        head: input.messages.slice(0, keep.start),
        tail_start_id: keep.id,
      }
    })

    // goes backwards through parts until there are PRUNE_PROTECT tokens worth of tool
    // calls, then erases output of older tool calls to free context space
    const prune = Effect.fn("SessionCompaction.prune")(function* (input: { sessionID: SessionID }) {
      const cfg = yield* config.get()
      if (!cfg.compaction?.prune) return
      yield* Effect.logInfo("pruning")

      const msgs = yield* session
        .messages({ sessionID: input.sessionID })
        .pipe(Effect.catchIf(NotFoundError.isInstance, () => Effect.succeed(undefined)))
      if (!msgs) return

      let total = 0
      let pruned = 0
      const toPrune: SessionV1.ToolPart[] = []
      let turns = 0

      loop: for (let msgIndex = msgs.length - 1; msgIndex >= 0; msgIndex--) {
        const msg = msgs[msgIndex]
        if (msg.info.role === "user") turns++
        if (turns < 2) continue
        if (msg.info.role === "assistant" && msg.info.summary) break loop
        for (let partIndex = msg.parts.length - 1; partIndex >= 0; partIndex--) {
          const part = msg.parts[partIndex]
          if (part.type !== "tool") continue
          if (part.state.status !== "completed") continue
          if (PRUNE_PROTECTED_TOOLS.includes(part.tool)) continue
          if (part.state.time.compacted) break loop
          const estimate = Token.estimate(part.state.output)
          total += estimate
          if (total <= PRUNE_PROTECT) continue
          pruned += estimate
          toPrune.push(part)
        }
      }

      yield* Effect.logInfo("found", { pruned, total })
      if (pruned > PRUNE_MINIMUM) {
        for (const part of toPrune) {
          if (part.state.status === "completed") {
            part.state.time.compacted = Date.now()
            yield* session.updatePart(part)
          }
        }
        yield* Effect.logInfo("pruned", { count: toPrune.length })
      }
    })

    const processCompaction = Effect.fn("SessionCompaction.process")(function* (input: {
      parentID: MessageID
      messages: SessionV1.WithParts[]
      sessionID: SessionID
      auto: boolean
      overflow?: boolean
    }) {
      const parent = input.messages.findLast((m) => m.info.id === input.parentID)
      if (!parent || parent.info.role !== "user") {
        throw new Error(`Compaction parent must be a user message: ${input.parentID}`)
      }
      const userMessage = parent.info
      const compactionPart = parent.parts.find((part): part is SessionV1.CompactionPart => part.type === "compaction")

      let messages = input.messages
      let replay:
        | {
            info: SessionV1.User
            parts: SessionV1.Part[]
          }
        | undefined
      if (input.overflow) {
        const idx = input.messages.findIndex((m) => m.info.id === input.parentID)
        for (let i = idx - 1; i >= 0; i--) {
          const msg = input.messages[i]
          if (msg.info.role === "user" && !msg.parts.some((p) => p.type === "compaction")) {
            replay = { info: msg.info, parts: msg.parts }
            messages = input.messages.slice(0, i)
            break
          }
        }
        const hasContent =
          replay && messages.some((m) => m.info.role === "user" && !m.parts.some((p) => p.type === "compaction"))
        if (!hasContent) {
          replay = undefined
          messages = input.messages
        }
      }

      const agent = yield* agents.get("compaction")
      const model = agent.model
        ? yield* provider.getModel(agent.model.providerID, agent.model.modelID).pipe(Effect.orDie)
        : yield* provider.getModel(userMessage.model.providerID, userMessage.model.modelID).pipe(Effect.orDie)
      const cfg = yield* config.get()
      const history = compactionPart && messages.at(-1)?.info.id === input.parentID ? messages.slice(0, -1) : messages
      const prior = completedCompactions(history)
      const hidden = new Set(prior.flatMap((item) => [item.userIndex, item.assistantIndex]))
      const previousSummary = prior.at(-1)?.summary
      const selected = yield* select({
        messages: history.filter((_, index) => !hidden.has(index)),
        cfg,
        model,
        pivot: compactionPart?.pivot_message_id,
      })
      // Allow plugins to inject context or replace compaction prompt.
      const compacting = yield* plugin.trigger(
        "experimental.session.compacting",
        { sessionID: input.sessionID },
        { context: [], prompt: undefined },
      )
      const nextPrompt = compacting.prompt ?? buildPrompt({ previousSummary, context: compacting.context })

      // Session-memory fast compaction path (mirrors reference agent trySessionMemoryCompaction):
      // if memories are available, build the summary directly from them and
      // skip the full LLM summary call. Falls through to the LLM path when no
      // memories exist or the feature is disabled.
      let fastPathSummary: string | undefined
      if (cfg.compaction?.session_memory_compaction !== false) {
        const memories = yield* Effect.promise(() => readMemories())
        fastPathSummary = buildMemorySummary(memories, previousSummary)
        if (fastPathSummary) {
          yield* Effect.logInfo("compaction: using session-memory fast path", {
            "session.id": input.sessionID,
            memories: memories.length,
          })
        }
      }

      const ctx = yield* InstanceState.context
      const msg: SessionV1.Assistant = {
        id: MessageID.ascending(),
        role: "assistant",
        parentID: input.parentID,
        sessionID: input.sessionID,
        mode: "compaction",
        agent: "compaction",
        variant: userMessage.model.variant,
        summary: true,
        path: {
          cwd: ctx.directory,
          root: ctx.worktree,
        },
        cost: 0,
        tokens: {
          output: 0,
          input: 0,
          reasoning: 0,
          cache: { read: 0, write: 0 },
        },
        modelID: model.id,
        providerID: model.providerID,
        time: {
          created: Date.now(),
        },
      }
      yield* session.updateMessage(msg)

      let result: "compact" | "stop" | "continue"
      if (fastPathSummary) {
        // Fast path: write the memory-based summary directly, no LLM call.
        yield* session.updatePart({
          id: PartID.ascending(),
          messageID: msg.id,
          sessionID: input.sessionID,
          type: "text",
          text: fastPathSummary,
          time: { start: Date.now(), end: Date.now() },
        })
        msg.finish = "stop"
        yield* session.updateMessage(msg)
        result = "continue"
      } else {
        const msgs = structuredClone(selected.head)
        yield* plugin.trigger("experimental.chat.messages.transform", {}, { messages: msgs })
        const modelMessages = yield* MessageV2.toModelMessagesEffect(msgs, model, {
          stripMedia: true,
          toolOutputMaxChars: TOOL_OUTPUT_MAX_CHARS,
        })
        const processor = yield* processors.create({
          assistantMessage: msg,
          sessionID: input.sessionID,
          model,
        })
        result = yield* processor.process({
          user: userMessage,
          agent,
          sessionID: input.sessionID,
          tools: {},
          system: [],
          messages: [
            ...modelMessages,
            {
              role: "user",
              content: [{ type: "text", text: nextPrompt }],
            },
          ],
          model,
        })

        if (result === "compact") {
          processor.message.error = new SessionV1.ContextOverflowError({
            message: replay
              ? "Conversation history too large to compact - exceeds model context limit"
              : "Session too large to compact - context exceeds model limit even after stripping media",
          }).toObject()
          processor.message.finish = "error"
          yield* session.updateMessage(processor.message)
          return "stop"
        }
      }

      if (compactionPart && selected.tail_start_id && compactionPart.tail_start_id !== selected.tail_start_id) {
        yield* session.updatePart({
          ...compactionPart,
          tail_start_id: selected.tail_start_id,
        })
      }

      if (result === "continue" && input.auto) {
        if (replay) {
          const original = replay.info
          const replayMsg = yield* session.updateMessage({
            id: MessageID.ascending(),
            role: "user",
            sessionID: input.sessionID,
            time: { created: Date.now() },
            agent: original.agent,
            model: original.model,
            format: original.format,
            tools: original.tools,
            system: original.system,
          })
          for (const part of replay.parts) {
            if (part.type === "compaction") continue
            const replayPart =
              part.type === "file" && MessageV2.isMedia(part.mime)
                ? { type: "text" as const, text: `[Attached ${part.mime}: ${part.filename ?? "file"}]` }
                : part
            yield* session.updatePart({
              ...replayPart,
              id: PartID.ascending(),
              messageID: replayMsg.id,
              sessionID: input.sessionID,
            })
          }
        }

        if (!replay) {
          const info = yield* provider.getProvider(userMessage.model.providerID)
          if (
            info &&
            (yield* plugin.trigger(
              "experimental.compaction.autocontinue",
              {
                sessionID: input.sessionID,
                agent: userMessage.agent,
                model: yield* provider
                  .getModel(userMessage.model.providerID, userMessage.model.modelID)
                  .pipe(Effect.orDie),
                provider: {
                  source: info.source,
                  info,
                  options: info.options,
                },
                message: userMessage,
                overflow: input.overflow === true,
              },
              { enabled: true },
            )).enabled
          ) {
            const continueMsg = yield* session.updateMessage({
              id: MessageID.ascending(),
              role: "user",
              sessionID: input.sessionID,
              time: { created: Date.now() },
              agent: userMessage.agent,
              model: userMessage.model,
            })
            const text =
              (input.overflow
                ? "The previous request exceeded the provider's size limit due to large media attachments. The conversation was compacted and media files were removed from context. If the user was asking about attached images or files, explain that the attachments were too large to process and suggest they try again with smaller or fewer files.\n\n"
                : "") +
              "Continue if you have next steps, or stop and ask for clarification if you are unsure how to proceed."
            yield* session.updatePart({
              id: PartID.ascending(),
              messageID: continueMsg.id,
              sessionID: input.sessionID,
              type: "text",
              // Internal marker for auto-compaction followups so provider plugins
              // can distinguish them from manual post-compaction user prompts.
              // This is not a stable plugin contract and may change or disappear.
              metadata: { compaction_continue: true },
              synthetic: true,
              text,
              time: {
                start: Date.now(),
                end: Date.now(),
              },
            })
          }
        }
      }

      // msg.error covers both paths: the fast path never sets it, and the LLM
      // path mutates the same object via processor.message.
      if (msg.error) return "stop"
      if (result === "continue") {
        // A successful compaction rewrites the conversation head into a summary,
        // so any frozen per-callID truncation decisions built from the
        // pre-compaction tool outputs are stale. Drop them together with the
        // compacted-part entries created by microcompact/prune so the cache
        // stays bounded and the next serialization re-decides from the new
        // context (this previously only logged "cache invalidated" without
        // touching the actual session cache).
        MessageV2.resetTruncationDecisions()
        yield* Effect.logInfo("compaction: truncation cache cleared", { sessionID: input.sessionID })
        yield* events.publish(Event.Compacted, { sessionID: input.sessionID })
      }
      return result
    })

    const create = Effect.fn("SessionCompaction.create")(function* (input: {
      sessionID: SessionID
      agent: string
      model: { providerID: ProviderV2.ID; modelID: ModelV2.ID }
      auto: boolean
      overflow?: boolean
      pivot?: MessageID
    }) {
      const msg = yield* session.updateMessage({
        id: MessageID.ascending(),
        role: "user",
        model: input.model,
        sessionID: input.sessionID,
        agent: input.agent,
        time: { created: Date.now() },
      })
      yield* session.updatePart({
        id: PartID.ascending(),
        messageID: msg.id,
        sessionID: msg.sessionID,
        type: "compaction",
        auto: input.auto,
        overflow: input.overflow,
        pivot_message_id: input.pivot,
      })
    })

    return Service.of({
      isOverflow,
      microcompactIfNeeded,
      prune,
      process: processCompaction,
      create,
    })
  }),
)

export const node = LayerNode.make({
  service: Service,
  layer: layer,
  deps: [
    Config.node,
    Session.node,
    Agent.node,
    Plugin.node,
    SessionProcessor.node,
    Provider.node,
    EventV2Bridge.node,
    RuntimeFlags.node,
  ],
})

export * as SessionCompaction from "./compaction"

