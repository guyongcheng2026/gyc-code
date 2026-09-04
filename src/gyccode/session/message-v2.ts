import { SessionID, MessageID } from "./schema"
import { SessionV1 } from "@gyccode/core/v1/session"
import { ProviderV2 } from "@gyccode/core/provider"
import {
  APIError,
  AbortedError,
  Assistant,
  AuthError,
  CompactionPart,
  ContextOverflowError,
  Info,
  OutputLengthError,
  Part,
  SubtaskPart,
  User,
  WithParts,
} from "@gyccode/core/v1/session"

import { NamedError } from "@gyccode/core/util/error"
import { APICallError, convertToModelMessages, LoadAPIKeyError, type ModelMessage, type UIMessage } from "ai"
import { Database } from "@gyccode/core/database/database"
import { LayerNode } from "@gyccode/core/effect/layer-node"
import { NotFoundError } from "@/storage/storage"
import { and } from "drizzle-orm"
import { desc } from "drizzle-orm"
import { eq } from "drizzle-orm"
import { inArray } from "drizzle-orm"
import { lt } from "drizzle-orm"
import { or } from "drizzle-orm"
import { MessageTable, PartTable, SessionTable } from "@gyccode/core/session/sql"
import { ProviderError } from "@/provider/error"
import { iife } from "@/util/iife"
import { errorMessage } from "@/util/error"
import { isMedia } from "@/util/media"
import type { Provider } from "@/provider/provider"
import { Cause, Effect, Schema } from "effect"

/** Error shape thrown by Bun's fetch() when gzip/br decompression fails mid-stream */
interface FetchDecompressionError extends Error {
  code: "ZlibError"
  errno: number
  path: string
}

export const SYNTHETIC_ATTACHMENT_PROMPT = "Attached media from tool result:"
export { isMedia }

function truncateToolOutput(text: string, maxChars?: number, tool?: string) {
  if (!maxChars || text.length <= maxChars) return text
  const omitted = text.length - maxChars
  if (tool) recordTruncation(tool, omitted)
  return `${text.slice(0, maxChars)}\n[Tool output truncated for compaction: omitted ${omitted} chars]`
}

/** 单条 user 文本截断（缓存友好：限制病态大粘贴的每轮增量；正常消息不受影响）。 */
function truncateUserText(text: string, maxChars?: number) {
  if (!maxChars || text.length <= maxChars) return text
  const omitted = text.length - maxChars
  return `${text.slice(0, maxChars)}\n[User text truncated: omitted ${omitted} chars]`
}

const MAX_AGGREGATED_TOOL_CHARS = 100_000
const MIN_AGGREGATED_TOOL_KEEP_CHARS = 1_024

/** 缓存增量预算（小上下文窗口模型，如 DeepSeek v4-flash 128K）：
 * 综合命中率 ≈ 1 - 2/N（N=压缩前轮数），98.2% 需 N ≥ 112，
 * 即每轮增量 ≤ 0.9×128K/112 ≈ 1.03K token。单条工具输出注入上限 1.5K 字符
 * （约 400 token），单条 assistant 消息合计 24K 字符（约 6K token），
 * 保证长会话每轮增量可控、压缩前可跑 100+ 轮。 */
export const CACHE_FRIENDLY_TOOL_CHARS = 1_500
export const CACHE_FRIENDLY_AGGREGATE_CHARS = 24_000
export const CACHE_FRIENDLY_CONTEXT_LIMIT = 200_000

// 大窗口模型（200K~1M）宽松预算：单条 8K 字符（约 2K token）、合计 100K 字符。
// 实测 deepseek-v4-flash(1M 窗口) 若完全不截断，读文件工具结果可达 14.6K token，
// 首轮未命中成本巨大且每轮增量不可控；施加宽松截断后单条最大 2K token，
// 既保留工具输出关键信息，又让增量/前缀稳定可控。
export const CACHE_FRIENDLY_TOOL_CHARS_LARGE = 8_000
export const CACHE_FRIENDLY_AGGREGATE_CHARS_LARGE = 100_000
export const CACHE_FRIENDLY_CONTEXT_LIMIT_LARGE = 1_000_000

/** 按模型上下文窗口返回缓存友好预算；超大窗口（>1M）模型不额外收紧（返回 undefined）。 */
export function cacheFriendlyBudget(contextLimit: number | undefined) {
  if (contextLimit === undefined || contextLimit <= 0) return undefined
  if (contextLimit <= CACHE_FRIENDLY_CONTEXT_LIMIT) {
    // 小窗口（≤200K）：严格预算，每轮增量最小化。
    return { maxPerChar: CACHE_FRIENDLY_TOOL_CHARS, maxTotalChars: CACHE_FRIENDLY_AGGREGATE_CHARS }
  }
  if (contextLimit <= CACHE_FRIENDLY_CONTEXT_LIMIT_LARGE) {
    // 大窗口（200K~1M）：宽松预算，控制增量同时保留工具关键输出。
    return { maxPerChar: CACHE_FRIENDLY_TOOL_CHARS_LARGE, maxTotalChars: CACHE_FRIENDLY_AGGREGATE_CHARS_LARGE }
  }
  return undefined
}
// 工具类型感知的单条上限（大窗口模型）：结构化输出（read/grep/glob）截断安全，
// 文件内容可分段读取，上限收紧到 2K 字符（实测 4K 时首次未命中 1525 token，
// 2K 可进一步降至 ~800，且模型会自动降级 grep 搜索不破坏能力）；bash/其他
// 命令输出可能含关键错误信息，保留 8K。小窗口模型统一用 CACHE_FRIENDLY_TOOL_CHARS（1.5K）。
export const TOOL_TYPE_CAPS: Record<string, number> = {
  read: 2_000,
  grep: 2_000,
  glob: 2_000,
}

function toolTypeCap(tool: string, baseCap: number | undefined): number | undefined {
  if (baseCap === undefined) return undefined
  const typed = TOOL_TYPE_CAPS[tool]
  return typed !== undefined && typed < baseCap ? typed : baseCap
}

/**
 * 调用方单条截断上限：聚合决策（aggregateToolCaps 的 Map）仅当它是"真实截断"
 * （cap < 输出长度）时才采用；否则（全长度条目或 absent）回退到工具类型感知上限。
 * 修复：二次序列化时 allDecided 分支返回的全长度 Map 不再压制 per-tool 类型上限，
 * 保证跨轮序列化字节稳定（prompt-cache 友好，对齐 CH 99.9% 机制）。
 */
export function toolCapForOutput(
  caps: ReadonlyMap<string, number> | undefined,
  callID: string,
  output: string,
  tool: string,
  toolOutputMaxChars: number | undefined,
): number | undefined {
  const aggregate = caps?.get(callID)
  if (aggregate !== undefined && aggregate < output.length) return aggregate
  return toolTypeCap(tool, toolOutputMaxChars)
}

/** 冻结决策上限：超出即清空（长运行 server/serve 模式防止无界内存增长；
 * 旧 callID 在 compaction 后本就失效，清空不破坏跨轮字节稳定）。 */
export const TRUNCATION_DECISIONS_MAX = 10_000

/**
 * Frozen truncation decisions keyed by tool callID. Once a callID has been
 * decided (truncated or kept intact), the decision is recorded here and never
 * recomputed, so the serialized prompt prefix stays byte-stable across turns
 * (prompt-cache friendly). Mirrors reference agent partitionByPriorDecision.
 */
const truncationDecisions = new Map<string, number | undefined>()

/** 测试用：当前冻结决策数量。 */
export function truncationDecisionsSize(): number {
  return truncationDecisions.size
}

function freezeDecision(id: string, cap: number | undefined): void {
  if (truncationDecisions.size >= TRUNCATION_DECISIONS_MAX) truncationDecisions.clear()
  truncationDecisions.set(id, cap)
}

/** Reset frozen decisions (used by tests). */
export function resetTruncationDecisions(): void {
  truncationDecisions.clear()
}

// ─── 截断观测（幻觉率前置信号）─────────────────────────────────
// 证据截断（read/grep/glob 输出 cap）会迫使模型基于不完整信息补全，是幻觉率
// 的同一旋钮两端。按工具类型统计截断次数与被省略字符数，为 TOOL_TYPE_CAPS
// 阈值（2K↔4K）的闭环调参提供数据基础，避免拍脑袋回调。指标只读、零依赖、
// 仅在实际发生截断时自增，序列化热路径开销为一次 Map.get。
const truncationStats = new Map<string, { count: number; omittedChars: number }>()

function recordTruncation(tool: string, omittedChars: number): void {
  const entry = truncationStats.get(tool)
  if (entry) {
    entry.count++
    entry.omittedChars += omittedChars
  } else {
    truncationStats.set(tool, { count: 1, omittedChars })
  }
}

/** 当前截断统计快照（按工具类型）。供 /insights、诊断或测试读取。 */
export function truncationStatsSnapshot(): Record<string, { count: number; omittedChars: number }> {
  return Object.fromEntries(truncationStats)
}

/** Reset truncation stats (used by tests). */
export function resetTruncationStats(): void {
  truncationStats.clear()
}

/** 仅保留真实截断（cap < 当前输出长度）的条目；无任何截断返回 undefined。
 * 统一契约：Map 不含「全长度」条目，absent 即交给 per-tool 类型上限 fallback。 */
function onlyTruncated(caps: Map<string, number>, lens: Map<string, number>): Map<string, number> | undefined {
  const out = new Map<string, number>()
  for (const [callID, cap] of caps) {
    if (cap < (lens.get(callID) ?? 0)) out.set(callID, cap)
  }
  return out.size > 0 ? out : undefined
}

/**
 * Compute per-tool-result character caps for one assistant message tool
 * results: when the aggregate output exceeds the budget, truncate from the
 * largest output down, keeping at least 1KB of each. Truncation decisions are
 * frozen by callID once made: re-serializing the same message (or a later
 * message with the same callIDs) yields identical truncation -> stable prompt
 * cache prefix.
 *
 * 统一契约：返回的 Map 仅包含「真实截断」条目（cap < 当前输出长度）；没有任何截断
 * 时返回 undefined。调用方应经 `toolCaps?.get(callID) ?? toolTypeCap(tool, maxChars)`
 * （或 `toolCapForOutput`）读取有效上限——absent 条目意味着交给 per-tool 类型上限。
 */
export function aggregateToolCaps(
  parts: readonly SessionV1.Part[],
  opts?: { maxPerChar?: number; maxTotalChars?: number },
) {
  const caps = new Map<string, number>()
  const lens = new Map<string, number>()
  const callIDs: string[] = []
  let total = 0
  const maxPerChar = opts?.maxPerChar
  const maxTotalChars = opts?.maxTotalChars ?? MAX_AGGREGATED_TOOL_CHARS
  for (const part of parts) {
    if (part.type !== "tool") continue
    if (part.state.status !== "completed" || part.state.time.compacted) continue
    const callID = part.callID
    const text = part.state.output
    callIDs.push(callID)
    lens.set(callID, text.length)
    const perChar = toolTypeCap(part.tool, maxPerChar)
    const cap = perChar !== undefined && text.length > perChar ? perChar : text.length
    caps.set(callID, cap)
    total += cap
  }
  if (callIDs.length === 0) return undefined
  // All callIDs already decided? Reuse the frozen decision set exactly.
  const allDecided = callIDs.every((id) => truncationDecisions.has(id))
  if (allDecided) {
    for (const id of callIDs) {
      const keep = truncationDecisions.get(id)
      caps.set(id, keep ?? lens.get(id) ?? 0)
    }
    return onlyTruncated(caps, lens)
  }
  if (total <= maxTotalChars) {
    // Under budget: freeze the cap to apply for each callID (a number, possibly
    // the full length for kept tools) so a later re-serialization stays byte-stable.
    for (const id of callIDs) {
      if (!truncationDecisions.has(id)) freezeDecision(id, caps.get(id))
    }
    return onlyTruncated(caps, lens)
  }
  let excess = total - maxTotalChars
  // Deterministic order: largest length first, then ascending callID.
  const entries = [...caps.entries()].sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0))
  for (const [callID, length] of entries) {
    if (excess <= 0) break
    if (length <= MIN_AGGREGATED_TOOL_KEEP_CHARS) continue
    const keep = Math.max(MIN_AGGREGATED_TOOL_KEEP_CHARS, length - excess)
    if (keep >= length) continue
    caps.set(callID, keep)
    excess -= length - keep
  }
  // Record the full decision set for this batch.
  for (const id of callIDs) freezeDecision(id, caps.get(id) ?? undefined)
  return onlyTruncated(caps, lens)
}

export const Event = {
  Updated: SessionV1.Event.MessageUpdated,
  Removed: SessionV1.Event.MessageRemoved,
  PartUpdated: SessionV1.Event.PartUpdated,
  PartDelta: SessionV1.Event.PartDelta,
  PartRemoved: SessionV1.Event.PartRemoved,
}

const Cursor = Schema.Struct({
  id: MessageID,
  time: Schema.Finite.check(Schema.isGreaterThanOrEqualTo(0)),
})
type Cursor = typeof Cursor.Type

const decodeCursor = Schema.decodeUnknownSync(Cursor)

export const cursor = {
  encode(input: Cursor) {
    return Buffer.from(JSON.stringify(input)).toString("base64url")
  },
  decode(input: string) {
    return decodeCursor(JSON.parse(Buffer.from(input, "base64url").toString("utf8")))
  },
}

const info = (row: typeof MessageTable.$inferSelect) =>
  ({
    ...row.data,
    id: row.id,
    sessionID: row.session_id,
  }) as Info

const part = (row: typeof PartTable.$inferSelect) =>
  ({
    ...row.data,
    id: row.id,
    sessionID: row.session_id,
    messageID: row.message_id,
  }) as Part

const older = (row: Cursor) =>
  or(lt(MessageTable.time_created, row.time), and(eq(MessageTable.time_created, row.time), lt(MessageTable.id, row.id)))

function hydrate(db: Database.Interface["db"], rows: (typeof MessageTable.$inferSelect)[]) {
  const ids = rows.map((row) => row.id)
  const partByMessage = new Map<string, Part[]>()
  return Effect.gen(function* () {
    if (ids.length > 0) {
      const partRows = yield* db
        .select()
        .from(PartTable)
        .where(inArray(PartTable.message_id, ids))
        .orderBy(PartTable.message_id, PartTable.id)
        .all()
        .pipe(Effect.orDie)
      for (const row of partRows) {
        const next = part(row)
        const list = partByMessage.get(row.message_id)
        if (list) list.push(next)
        else partByMessage.set(row.message_id, [next])
      }
    }

    return rows.map((row) => ({
      info: info(row),
      parts: partByMessage.get(row.id) ?? [],
    }))
  })
}

function providerMeta(metadata: Record<string, any> | undefined) {
  if (!metadata) return undefined
  const { providerExecuted: _, ...rest } = metadata
  return Object.keys(rest).length > 0 ? rest : undefined
}

export const toModelMessagesEffect = Effect.fnUntraced(function* (
  input: readonly WithParts[],
  model: Provider.Model,
  options?: {
    stripMedia?: boolean
    toolOutputMaxChars?: number
    toolOutputMaxTotalChars?: number
    /** 追加到最新 user 消息末尾的记忆内容（tail 注入，字节稳定；不影响历史 user 消息）。 */
    injectMemories?: string
    /** 追加到最新 user 消息末尾的日期内容（同 tail 模式，跨天只影响当轮增量）。 */
    injectDate?: string
    /** 单条 user 文本字符上限（缓存友好：限制病态大粘贴的每轮增量）。 */
    maxUserTextChars?: number
  },
) {
  const result: UIMessage[] = []
  const toolNames = new Set<string>()
  // Track media from tool results that need to be injected as user messages
  // for providers that don't support that media type in tool results.
  //
  // OpenAI-compatible APIs only support string content in tool results, so we need
  // to extract media and inject as user messages. Some SDKs only support a subset
  // of media in tool results; e.g. Bedrock supports images but not PDFs there.
  //
  // Only apply this workaround if the model actually supports that media input -
  // otherwise unsupportedParts() will turn it into a user-visible error.
  const supportsMediaInToolResult = (attachment: { mime: string }) => {
    if (model.api.npm === "@ai-sdk/anthropic") return true
    if (model.api.npm === "@ai-sdk/openai") return true
    if (model.api.npm === "@ai-sdk/amazon-bedrock/mantle") return true
    if (model.api.npm === "@ai-sdk/amazon-bedrock") return attachment.mime.startsWith("image/")
    if (model.api.npm === "@ai-sdk/google-vertex/anthropic") return true
    if (model.api.npm === "@ai-sdk/google") {
      const id = model.api.id.toLowerCase()
      return id.includes("gemini-3") && !id.includes("gemini-2")
    }
    return false
  }

  const toModelOutput = (options: { toolCallId: string; input: unknown; output: unknown }) => {
    const output = options.output
    if (typeof output === "string") {
      return { type: "text", value: output }
    }

    if (typeof output === "object") {
      const outputObject = output as {
        text: string
        attachments?: Array<{ mime: string; url: string }>
      }
      const attachments = (outputObject.attachments ?? []).filter((attachment) => {
        return attachment.url.startsWith("data:") && attachment.url.includes(",")
      })

      return {
        type: "content",
        value: [
          ...(outputObject.text ? [{ type: "text", text: outputObject.text }] : []),
          ...attachments.map((attachment) => ({
            type: "media",
            mediaType: attachment.mime,
            data: iife(() => {
              const commaIndex = attachment.url.indexOf(",")
              return commaIndex === -1 ? attachment.url : attachment.url.slice(commaIndex + 1)
            }),
          })),
        ],
      }
    }

    return { type: "json", value: output as never }
  }

  // 预计算第一条 user 消息索引：日期/记忆只注入该消息（前缀固定增量），
  // 使注入内容在连续请求间字节稳定（对齐 CH 99.9% 机制：注入位置不逐轮游走，
  // 否则每轮都会在"上一条最新 user 消息"处折断缓存前缀，实测 CH 99.3% 的主要泄漏源）。
  let firstUserIdx = -1
  for (let i = 0; i < input.length; i++) {
    if (input[i].info.role === "user") {
      firstUserIdx = i
      break
    }
  }
  for (let i = 0; i < input.length; i++) {
    const msg = input[i]
    if (msg.parts.length === 0) continue

    if (msg.info.role === "user") {
      const userMessage: UIMessage = {
        id: msg.info.id,
        role: "user",
        parts: [],
      }
      for (const part of msg.parts) {
        // User message parts should never be empty
        if (part.type === "text" && !part.ignored && part.text !== "")
          userMessage.parts.push({
            type: "text",
            text: truncateUserText(part.text, options?.maxUserTextChars),
          })
        // text/plain and directory files are converted into text parts, ignore them
        if (part.type === "file" && part.mime !== "text/plain" && part.mime !== "application/x-directory") {
          if (options?.stripMedia && isMedia(part.mime)) {
            userMessage.parts.push({
              type: "text",
              text: `[Attached ${part.mime}: ${part.filename ?? "file"}]`,
            })
          } else {
            userMessage.parts.push({
              type: "file",
              url: part.url,
              mediaType: part.mime,
              filename: part.filename,
            })
          }
        }

        if (part.type === "compaction") {
          userMessage.parts.push({
            type: "text",
            text: "What did we do so far?",
          })
        }
        if (part.type === "subtask") {
          userMessage.parts.push({
            type: "text",
            text: "The following tool was executed by the user",
          })
        }
      }
      // 日期/记忆前缀固定注入：仅追加到第一条 user 消息（历史 user 消息不含 →
      // 注入位置不再逐轮游走，前缀字节稳定）
      if (i === firstUserIdx) {
        if (options?.injectDate && options.injectDate.trim() !== "") {
          userMessage.parts.push({ type: "text", text: options.injectDate })
        }
        if (options?.injectMemories && options.injectMemories.trim() !== "") {
          userMessage.parts.push({ type: "text", text: options.injectMemories })
        }
      }
      if (userMessage.parts.length > 0) result.push(userMessage)
    }

    if (msg.info.role === "assistant") {
      const differentModel = `${model.providerID}/${model.id}` !== `${msg.info.providerID}/${msg.info.modelID}`
      const media: Array<{ mime: string; url: string; filename?: string }> = []

      if (
        msg.info.error &&
        !(
          AbortedError.isInstance(msg.info.error) &&
          msg.parts.some((part) => part.type !== "step-start" && part.type !== "reasoning")
        )
      ) {
        continue
      }
      const assistantMessage: UIMessage = {
        id: msg.info.id,
        role: "assistant",
        parts: [],
      }
      // Anthropic adaptive thinking can persist assistant turns like:
      // step-start, reasoning(signature), text(""), step-start,
      // reasoning(signature). The empty text part is a structural separator,
      // but it does not carry the signature metadata itself. Dropping it shifts
      // signed thinking positions after step-start splitting/provider regrouping;
      // keeping it as "" is filtered by the AI SDK and rejected by Anthropic.
      // It is unclear whether this shape originates in our stream processing,
      // a proxy, or a lower-level library, but preserving a non-empty separator
      // here is the only safe replay point we have.
      // Use a single space so the separator survives replay without changing
      // the neighboring signed reasoning blocks.
      const hasSignedReasoning = msg.parts.some((part) => {
        if (part.type !== "reasoning") return false
        return part.metadata?.anthropic?.signature != null
      })
      const toolCaps = aggregateToolCaps(msg.parts, {
        maxTotalChars: options?.toolOutputMaxTotalChars,
      })
      for (const part of msg.parts) {
        if (part.type === "text") {
          const text = part.text === "" && hasSignedReasoning ? " " : part.text
          assistantMessage.parts.push({
            type: "text",
            text,
            ...(differentModel ? {} : { providerMetadata: part.metadata }),
          })
        }
        if (part.type === "step-start")
          assistantMessage.parts.push({
            type: "step-start",
          })
        if (part.type === "tool") {
          toolNames.add(part.tool)
          if (part.state.status === "completed") {
            // 2026-08-27 摘要式压缩：compact 过的工具输出保留头部摘要。新旧
            // 数据都走 truncateToolOutput——新数据 markCompacted 时已把 output
            // 截断为 2K 摘要（re-truncate 无副作用），旧数据在此实时截断。
            // 不再使用固定占位符，LLM 能看到真实摘要，显著降低压缩后幻觉率。
            const outputText = truncateToolOutput(
              part.state.output,
              toolCapForOutput(toolCaps, part.callID, part.state.output, part.tool, options?.toolOutputMaxChars),
              part.tool,
            )
            const attachments = part.state.time.compacted || options?.stripMedia ? [] : (part.state.attachments ?? [])

            // For providers that don't support media in tool results, extract media files
            // (images, PDFs) to be sent as a separate user message
            const mediaAttachments = attachments.filter((a) => isMedia(a.mime))
            const extractedMedia = mediaAttachments.filter((a) => !supportsMediaInToolResult(a))
            if (extractedMedia.length > 0) {
              media.push(...extractedMedia)
            }
            const finalAttachments = attachments.filter((a) => !isMedia(a.mime) || supportsMediaInToolResult(a))

            const output =
              finalAttachments.length > 0
                ? {
                    text: outputText,
                    attachments: finalAttachments,
                  }
                : outputText

            assistantMessage.parts.push({
              type: ("tool-" + part.tool) as `tool-${string}`,
              state: "output-available",
              toolCallId: part.callID,
              input: part.state.input,
              output,
              ...(part.metadata?.providerExecuted ? { providerExecuted: true } : {}),
              ...(differentModel ? {} : { callProviderMetadata: providerMeta(part.metadata) }),
            })
          }
          if (part.state.status === "error") {
            const output = part.state.metadata?.interrupted === true ? part.state.metadata.output : undefined
            if (typeof output === "string") {
              assistantMessage.parts.push({
                type: ("tool-" + part.tool) as `tool-${string}`,
                state: "output-available",
                toolCallId: part.callID,
                input: part.state.input,
                output,
                ...(part.metadata?.providerExecuted ? { providerExecuted: true } : {}),
                ...(differentModel ? {} : { callProviderMetadata: providerMeta(part.metadata) }),
              })
            } else {
              assistantMessage.parts.push({
                type: ("tool-" + part.tool) as `tool-${string}`,
                state: "output-error",
                toolCallId: part.callID,
                input: part.state.input,
                errorText: part.state.error,
                ...(part.metadata?.providerExecuted ? { providerExecuted: true } : {}),
                ...(differentModel ? {} : { callProviderMetadata: providerMeta(part.metadata) }),
              })
            }
          }
          // Handle pending/running tool calls to prevent dangling tool_use blocks
          // Anthropic/Claude APIs require every tool_use to have a corresponding tool_result
          if (part.state.status === "pending" || part.state.status === "running")
            assistantMessage.parts.push({
              type: ("tool-" + part.tool) as `tool-${string}`,
              state: "output-error",
              toolCallId: part.callID,
              input: part.state.input,
              errorText: "[Tool execution was interrupted]",
              ...(part.metadata?.providerExecuted ? { providerExecuted: true } : {}),
              ...(differentModel ? {} : { callProviderMetadata: providerMeta(part.metadata) }),
            })
        }
        if (part.type === "reasoning") {
          if (differentModel) {
            if (part.text.trim().length > 0)
              assistantMessage.parts.push({
                type: "text",
                text: part.text,
              })
            continue
          }
          assistantMessage.parts.push({
            type: "reasoning",
            text: part.text,
            providerMetadata: part.metadata,
          })
        }
      }
      if (assistantMessage.parts.length > 0) {
        result.push(assistantMessage)
        // Inject pending media as a user message for providers that don't support
        // media (images, PDFs) in tool results
        if (media.length > 0) {
          result.push({
            id: MessageID.ascending(),
            role: "user",
            parts: [
              {
                type: "text" as const,
                text: SYNTHETIC_ATTACHMENT_PROMPT,
              },
              ...media.map((attachment) => ({
                type: "file" as const,
                url: attachment.url,
                mediaType: attachment.mime,
                filename: attachment.filename,
              })),
            ],
          })
        }
      }
    }
  }

  const tools = Object.fromEntries(Array.from(toolNames).map((toolName) => [toolName, { toModelOutput }]))

  return yield* Effect.promise(() =>
    convertToModelMessages(
      result.filter((msg) => msg.parts.some((part) => part.type !== "step-start")),
      {
        //@ts-expect-error (convertToModelMessages expects a ToolSet but only actually needs tools[name]?.toModelOutput)
        tools,
      },
    ),
  )
})

export function toModelMessages(
  input: readonly WithParts[],
  model: Provider.Model,
  options?: {
    stripMedia?: boolean
    toolOutputMaxChars?: number
    toolOutputMaxTotalChars?: number
    /** 追加到最新 user 消息末尾的记忆内容（tail 注入，字节稳定；不影响历史 user 消息）。 */
    injectMemories?: string
    /** 追加到最新 user 消息末尾的日期内容（同 tail 模式，跨天只影响当轮增量）。 */
    injectDate?: string
    /** 单条 user 文本字符上限（缓存友好：限制病态大粘贴的每轮增量）。 */
    maxUserTextChars?: number
  },
): Promise<ModelMessage[]> {
  return Effect.runPromise(toModelMessagesEffect(input, model, options))
}

export const page = Effect.fn("MessageV2.page")(function* (input: {
  sessionID: SessionID
  limit: number
  before?: string
}) {
  const { db } = yield* Database.Service
  const before = input.before ? cursor.decode(input.before) : undefined
  const where = before
    ? and(eq(MessageTable.session_id, input.sessionID), older(before))
    : eq(MessageTable.session_id, input.sessionID)
  const rows = yield* db
    .select()
    .from(MessageTable)
    .where(where)
    .orderBy(desc(MessageTable.time_created), desc(MessageTable.id))
    .limit(input.limit + 1)
    .all()
    .pipe(Effect.orDie)
  if (rows.length === 0) {
    const row = yield* db
      .select({ id: SessionTable.id })
      .from(SessionTable)
      .where(eq(SessionTable.id, input.sessionID))
      .get()
      .pipe(Effect.orDie)
    if (!row) return yield* new NotFoundError({ message: `Session not found: ${input.sessionID}` })
    return {
      items: [] as WithParts[],
      more: false,
    }
  }

  const more = rows.length > input.limit
  const slice = more ? rows.slice(0, input.limit) : rows
  const items = yield* hydrate(db, slice)
  items.reverse()
  const tail = slice.at(-1)
  return {
    items,
    more,
    cursor: more && tail ? cursor.encode({ id: tail.id, time: tail.time_created }) : undefined,
  }
})

export function stream(sessionID: SessionID) {
  const size = 50
  return Effect.gen(function* () {
    const result = [] as WithParts[]
    let before: string | undefined
    while (true) {
      const next = yield* page({ sessionID, limit: size, before }).pipe(
        Effect.catchIf(NotFoundError.isInstance, () =>
          Effect.succeed({ items: [] as WithParts[], more: false, cursor: undefined }),
        ),
      )
      if (next.items.length === 0) break
      for (let i = next.items.length - 1; i >= 0; i--) {
        const item = next.items[i]
        if (item) result.push(item)
      }
      if (!next.more || !next.cursor) break
      before = next.cursor
    }
    return result
  })
}

export function parts(messageID: MessageID) {
  return Effect.gen(function* () {
    const { db } = yield* Database.Service
    const rows = yield* db
      .select()
      .from(PartTable)
      .where(eq(PartTable.message_id, messageID))
      .orderBy(PartTable.id)
      .all()
      .pipe(Effect.orDie)
    return rows.map(part)
  })
}

export const get = Effect.fn("MessageV2.get")(function* (input: { sessionID: SessionID; messageID: MessageID }) {
  const { db } = yield* Database.Service
  const row = yield* db
    .select()
    .from(MessageTable)
    .where(and(eq(MessageTable.id, input.messageID), eq(MessageTable.session_id, input.sessionID)))
    .get()
    .pipe(Effect.orDie)
  if (!row) return yield* new NotFoundError({ message: `Message not found: ${input.messageID}` })
  return {
    info: info(row),
    parts: yield* parts(input.messageID),
  }
})

export function filterCompacted(msgs: Iterable<WithParts>) {
  const result = [] as WithParts[]
  const completed = new Set<string>()
  let retain: MessageID | undefined
  for (const msg of msgs) {
    result.push(msg)
    if (retain) {
      if (msg.info.id === retain) break
      continue
    }
    if (msg.info.role === "user" && completed.has(msg.info.id)) {
      const part = msg.parts.find((item): item is CompactionPart => item.type === "compaction")
      if (!part) continue
      if (!part.tail_start_id) break
      retain = part.tail_start_id
      if (msg.info.id === retain) break
      continue
    }
    if (msg.info.role === "user" && completed.has(msg.info.id) && msg.parts.some((part) => part.type === "compaction"))
      break
    if (msg.info.role === "assistant" && msg.info.summary && msg.info.finish && !msg.info.error)
      completed.add(msg.info.parentID)
  }
  result.reverse()
  const compactionIndex = result.findLastIndex(
    (msg) =>
      msg.info.role === "user" &&
      msg.parts.some((item): item is CompactionPart => item.type === "compaction" && item.tail_start_id !== undefined),
  )
  const compaction = result[compactionIndex]
  const part = compaction?.parts.find(
    (item): item is CompactionPart => item.type === "compaction" && item.tail_start_id !== undefined,
  )
  const summaryIndex = compaction
    ? result.findIndex(
        (msg, index) =>
          index > compactionIndex &&
          msg.info.role === "assistant" &&
          msg.info.summary &&
          msg.info.parentID === compaction.info.id,
      )
    : -1
  const tailIndex = part?.tail_start_id ? result.findIndex((msg) => msg.info.id === part.tail_start_id) : -1
  if (tailIndex >= 0 && tailIndex < compactionIndex && summaryIndex > compactionIndex) {
    return [
      ...result.slice(compactionIndex, summaryIndex + 1),
      ...result.slice(tailIndex, compactionIndex),
      ...result.slice(summaryIndex + 1),
    ]
  }
  return result
}

export const filterCompactedEffect = Effect.fnUntraced(function* (sessionID: SessionID) {
  return filterCompacted(yield* stream(sessionID))
})

// filterCompacted reorders messages for model consumption
// ([compaction-user, summary, ...retained tail..., continue-user]), so array
// position is not chronological. Derive each binding by max id (MessageID
// is monotonic via MessageID.ascending) so a pre-compaction overflowing tail
// assistant doesn't get mistaken for the most recent turn. tasks are
// compaction/subtask parts attached to user messages newer than the latest
// finished assistant — i.e. unprocessed work.
export function latest(msgs: WithParts[]) {
  let user: User | undefined
  let assistant: Assistant | undefined
  let finished: Assistant | undefined
  for (const msg of msgs) {
    const info = msg.info
    if (info.role === "user" && (!user || info.id > user.id)) user = info
    if (info.role === "assistant" && (!assistant || info.id > assistant.id)) assistant = info
    if (info.role === "assistant" && info.finish && (!finished || info.id > finished.id)) finished = info
  }
  const tasks = msgs.flatMap((m) =>
    finished && m.info.id <= finished.id
      ? []
      : m.parts.filter((p): p is CompactionPart | SubtaskPart => p.type === "compaction" || p.type === "subtask"),
  )
  return { user, assistant, finished, tasks }
}

export function fromError(
  e: unknown,
  ctx: { providerID: ProviderV2.ID; aborted?: boolean },
): NonNullable<Assistant["error"]> {
  switch (true) {
    case e instanceof DOMException && e.name === "AbortError":
      return new AbortedError(
        { message: e.message },
        {
          cause: e,
        },
      ).toObject()
    case OutputLengthError.isInstance(e):
      return e
    case LoadAPIKeyError.isInstance(e):
      return new AuthError(
        {
          providerID: ctx.providerID,
          message: e.message,
        },
        { cause: e },
      ).toObject()
    case (e as NodeJS.ErrnoException)?.code === "ECONNRESET":
      return new APIError(
        {
          message: "Connection reset by server",
          isRetryable: true,
          metadata: {
            code: (e as NodeJS.ErrnoException).code ?? "",
            syscall: (e as NodeJS.ErrnoException).syscall ?? "",
            message: (e as NodeJS.ErrnoException).message ?? "",
          },
        },
        { cause: e },
      ).toObject()
    case e instanceof Error && (e as FetchDecompressionError).code === "ZlibError":
      if (ctx.aborted) {
        return new AbortedError({ message: e.message }, { cause: e }).toObject()
      }
      return new APIError(
        {
          message: "Response decompression failed",
          isRetryable: true,
          metadata: {
            code: (e as FetchDecompressionError).code,
            message: e.message,
          },
        },
        { cause: e },
      ).toObject()
    case Cause.isTimeoutError(e):
      // effect 内核 TimeoutError（如 llm-timeout.ts 的首事件超时 Effect.timeout）：
      // 无 message 字段，若落入下方 Error 分支会以 name "TimeoutError" 直接展示给用户。
      // 映射为可重试 APIError，走 SessionRetry 重试路径并给出可读文案。
      return new APIError(
        {
          message: "模型响应超时：连接已建立但长时间未收到首个响应事件，可能是网络中断或服务端无响应",
          isRetryable: true,
          metadata: {
            code: "TimeoutError",
          },
        },
        { cause: e },
      ).toObject()
    case e instanceof ProviderError.HeaderTimeoutError:
      return new APIError(
        {
          message: e.message,
          isRetryable: true,
          metadata: {
            code: e.name,
            timeoutMs: String(e.ms),
          },
        },
        { cause: e },
      ).toObject()
    case e instanceof ProviderError.ResponseStreamError:
      return new APIError(
        {
          message: e.message,
          isRetryable: true,
          metadata: {
            code: e.name,
          },
        },
        { cause: e },
      ).toObject()
    case APICallError.isInstance(e):
      const parsed = ProviderError.parseAPICallError({
        providerID: ctx.providerID,
        error: e,
      })
      if (parsed.type === "context_overflow") {
        return new ContextOverflowError(
          {
            message: parsed.message,
            responseBody: parsed.responseBody,
          },
          { cause: e },
        ).toObject()
      }

      return new APIError(
        {
          message: parsed.message,
          statusCode: parsed.statusCode,
          isRetryable: parsed.isRetryable,
          responseHeaders: parsed.responseHeaders,
          responseBody: parsed.responseBody,
          metadata: parsed.metadata,
        },
        { cause: e },
      ).toObject()
    case e instanceof Error:
      return new NamedError.Unknown({ message: errorMessage(e) }, { cause: e }).toObject()
    default:
      try {
        const parsed = ProviderError.parseStreamError(e)
        if (parsed) {
          if (parsed.type === "context_overflow") {
            return new ContextOverflowError(
              {
                message: parsed.message,
                responseBody: parsed.responseBody,
              },
              { cause: e },
            ).toObject()
          }
          return new APIError(
            {
              message: parsed.message,
              isRetryable: parsed.isRetryable,
              responseBody: parsed.responseBody,
            },
            {
              cause: e,
            },
          ).toObject()
        }
      } catch {
        // `e` did not match the structured API error shape (e.g. a plain
        // Error or a non-JSON failure): fall through to NamedError.Unknown
        // instead of rethrowing from inside error serialization.
      }
      return new NamedError.Unknown({ message: JSON.stringify(e) }, { cause: e }).toObject()
  }
}

export * as MessageV2 from "./message-v2"
export const node = LayerNode.group([Database.node])
