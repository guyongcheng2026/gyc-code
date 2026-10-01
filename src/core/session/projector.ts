export * as SessionProjector from "./projector"

import { and, desc, eq, gt, or, sql } from "drizzle-orm"
import { DateTime, Effect, Layer, Schema } from "effect"
import { Database } from "../database/database"
import { EventV2 } from "../event"
import { makeGlobalNode } from "../effect/app-node"
import { SessionEvent } from "./event"
import { SessionV1 } from "../v1/session"
import { WorkspaceTable } from "../control-plane/workspace.sql"
import { SessionMessage } from "./message"
import { SessionMessageUpdater } from "./message-updater"
import { SessionInput } from "./input"
import { WorkspaceV2 } from "../workspace"
import { SessionContextEpoch } from "./context-epoch"
import { MessageTable, PartTable, SessionInputTable, SessionMessageTable, SessionTable, CostLedgerTable } from "./sql"
import { ModelV2 } from "../model"
import { ProviderV2 } from "../provider"
import type { DeepMutable } from "../schema"
import { MessageID } from "../v1/session"
import { SessionSchema } from "./schema"
import * as TaskProjector from "./task-projector"

type DatabaseService = Database.Interface["db"]

const decodeMessage = Schema.decodeUnknownSync(SessionMessage.Message)
const encodeMessage = Schema.encodeSync(SessionMessage.Message)

export class SessionAlreadyProjected extends Error {}

type Usage = {
  cost: number
  tokens: {
    input: number
    output: number
    reasoning: number
    cache: { read: number; write: number }
  }
  /**
   * C-08：本 step 是压缩开销。费用照样进 cost_ledger / session.cost（钱确实花了），
   * 但不计入 task.cost —— 压缩是维持会话的固定开销，不是本轮任务的产出。
   */
  compaction?: boolean
}

function usage(part: (typeof SessionV1.Event.PartUpdated.Type)["data"]["part"] | unknown): Usage | undefined {
  if (typeof part !== "object" || part === null) return undefined
  const value = part as Record<string, unknown>
  if (value.type !== "step-finish") return undefined
  if (!("cost" in value) || !("tokens" in value)) return undefined
  return {
    cost: value.cost as Usage["cost"],
    tokens: value.tokens as Usage["tokens"],
    compaction: value.compaction === true ? true : undefined,
  }
}

function sessionRow(info: SessionV1.SessionInfo): typeof SessionTable.$inferInsert {
  return {
    id: info.id,
    project_id: info.projectID,
    workspace_id: info.workspaceID ?? null,
    parent_id: info.parentID,
    slug: info.slug,
    directory: info.directory,
    path: info.path,
    title: info.title,
    agent: info.agent,
    model: info.model,
    version: info.version,
    share_url: info.share?.url,
    summary_additions: info.summary?.additions,
    summary_deletions: info.summary?.deletions,
    summary_files: info.summary?.files,
    summary_diffs: info.summary?.diffs ? [...info.summary.diffs] : undefined,
    metadata: info.metadata,
    cost: info.cost ?? 0,
    tokens_input: (info.tokens ?? { input: 0 }).input,
    tokens_output: (info.tokens ?? { output: 0 }).output,
    tokens_reasoning: (info.tokens ?? { reasoning: 0 }).reasoning,
    tokens_cache_read: (info.tokens ?? { cache: { read: 0 } }).cache.read,
    tokens_cache_write: (info.tokens ?? { cache: { write: 0 } }).cache.write,
    revert: info.revert ? { ...info.revert, messageID: SessionMessage.ID.make(info.revert.messageID) } : null,
    permission: info.permission ? [...info.permission] : undefined,
    time_created: info.time.created,
    time_updated: info.time.updated,
    time_compacting: info.time.compacting,
    time_archived: info.time.archived,
  }
}

function messageData(
  info: (typeof SessionV1.Event.MessageUpdated.Type)["data"]["info"],
): typeof MessageTable.$inferInsert.data {
  const { id: _, sessionID: __, ...rest } = info
  return rest as DeepMutable<typeof rest>
}

function partData(part: (typeof SessionV1.Event.PartUpdated.Type)["data"]["part"]): typeof PartTable.$inferInsert.data {
  const { id: _, messageID: __, sessionID: ___, ...rest } = part
  return rest as DeepMutable<typeof rest>
}

/**
 * 祖先链上卷深度上限。parent_id 是普通可写字段，理论上可被构造成环；上卷必须
 * 自带深度闸门，否则一次事件投影就能把数据库拖进死循环。
 */
const ROLLUP_MAX_DEPTH = 32

type SessionIDLike = (typeof SessionV1.Event.MessageUpdated.Type)["data"]["sessionID"]

/** 该 session 的所有祖先 id（不含自身，从近到远）。 */
function ancestorChain(db: DatabaseService, sessionID: SessionIDLike): Effect.Effect<SessionIDLike[]> {
  return Effect.gen(function* () {
    // 从 sessionID 的父节点起步，自身绝不进入结果 —— 否则上卷会把自身再计一次。
    const row = yield* db
      .select({ parent_id: SessionTable.parent_id })
      .from(SessionTable)
      .where(eq(SessionTable.id, sessionID))
      .get()
      .pipe(Effect.orDie)
    return yield* walkUp(db, row?.parent_id ?? null, [String(sessionID)], 0)
  })
}

function walkUp(
  db: DatabaseService,
  start: SessionIDLike | null,
  seen: readonly string[],
  depth: number,
): Effect.Effect<SessionIDLike[], never, never> {
  if (!start || depth >= ROLLUP_MAX_DEPTH || seen.includes(start)) return Effect.succeed([])
  return Effect.gen(function* () {
    const row = yield* db
      .select({ parent_id: SessionTable.parent_id })
      .from(SessionTable)
      .where(eq(SessionTable.id, start))
      .get()
      .pipe(Effect.orDie)
    // 会话已不存在：链到此为止（其自身的用量由它自己的投影负责）
    if (!row) return [start] as SessionIDLike[]
    const rest = yield* walkUp(db, row.parent_id ?? null, [...seen, start], depth + 1)
    return [start, ...rest]
  })
}

/**
 * 逐级向父会话累加用量。
 *
 * 2026-09-30（每任务成本 P0）：此前 applyUsage 只写 sessionID 自身那一行，而
 * 子代理跑在**独立 session**（tool/task.ts:165-181），其花费落子会话的 cost 列。
 * 全仓没有任何向上遍历 parent_id 的代码，于是父任务 spawn 5 个子代理时，父
 * session.cost 漏掉 5 份全额 —— 谷总看到的「这个任务花了多少」实际是下限，
 * 子代理越多低估越严重。
 *
 * 现把同一增量逐级上卷到所有祖先。注意 sign 必须一起传递：消息被改写/删除时
 * 走的是 -1 回退（见下方 PartUpdated / PartRemoved 投影），若只回退自身不回退
 * 祖先，父子两侧会永久性对不上账。
 *
 * 配套要求：所有「全表求和」的聚合（store.ts costStats、sidebar）必须改为只
 * 统计根会话，否则父子各算一遍会重复计数。
 */
function rollupUsage(
  db: DatabaseService,
  events: EventV2.Interface,
  sessionID: SessionIDLike,
  value: Usage,
  sign: number,
) {
  return ancestorChain(db, sessionID).pipe(
    Effect.flatMap((chain) =>
      Effect.forEach(chain, (ancestorID) => addUsageRow(db, events, ancestorID, value, sign), {
        concurrency: 1,
        discard: true,
      }),
    ),
  )
}

function addUsageRow(
  db: DatabaseService,
  events: EventV2.Interface,
  sessionID: SessionIDLike,
  value: Usage,
  sign: number,
) {
  return Effect.gen(function* () {
    // Check if session exists first
    const session = yield* db
      .select({ id: SessionTable.id })
      .from(SessionTable)
      .where(eq(SessionTable.id, sessionID))
      .get()
      .pipe(Effect.orDie)
    if (!session) return

    // C-05: append-only cost ledger — always insert positive entry.
    // C-08: 压缩开销用 event_type="compaction" 标记，报表可单列（钱确实花了）。
    yield* db
      .insert(CostLedgerTable)
      .values({
        session_id: sessionID as SessionSchema.ID,
        event_type: value.compaction ? ("compaction" as const) : ("usage" as const),
        cost_usd: value.cost,
        tokens_input: value.tokens.input,
        tokens_output: value.tokens.output,
        tokens_cache_read: value.tokens.cache.read,
        tokens_cache_write: value.tokens.cache.write,
        tokens_reasoning: value.tokens.reasoning,
        cost_source: "estimated" as const,
        metadata: {} as Record<string, unknown>,
      } as typeof CostLedgerTable.$inferInsert)
      .execute()
      .pipe(Effect.orDie)

    // Session table: only positive increments (no rollback)
    yield* db
      .update(SessionTable)
      .set({
        cost: sql`${SessionTable.cost} + ${value.cost}`,
        tokens_input: sql`${SessionTable.tokens_input} + ${value.tokens.input}`,
        tokens_output: sql`${SessionTable.tokens_output} + ${value.tokens.output}`,
        tokens_reasoning: sql`${SessionTable.tokens_reasoning} + ${value.tokens.reasoning}`,
        tokens_cache_read: sql`${SessionTable.tokens_cache_read} + ${value.tokens.cache.read}`,
        tokens_cache_write: sql`${SessionTable.tokens_cache_write} + ${value.tokens.cache.write}`,
        time_updated: sql`${SessionTable.time_updated}`,
      })
      .where(eq(SessionTable.id, sessionID))
      .execute()
      .pipe(Effect.orDie)

    yield* broadcastUsage(events, db, sessionID)
  })
}

export function applyUsage(
  db: DatabaseService,
  events: EventV2.Interface,
  sessionID: (typeof SessionV1.Event.MessageUpdated.Type)["data"]["sessionID"],
  value: Usage,
  sign = 1,
) {
  return addUsageRow(db, events, sessionID, value, sign).pipe(
    Effect.andThen(() => rollupUsage(db, events, sessionID, value, 1)),
    // C-01：同一份增量同时落到当前打开的 task，「每任务成本」才有数据来源。
    // C-08：压缩开销除外 —— 它是会话固定开销，算进 task 会高估「一个 feature 的成本」，
    // 且压缩策略一变，成本曲线就出现无法解释的跳变。
    Effect.andThen(() =>
      value.compaction ? Effect.void : TaskProjector.applyTaskUsage(db, sessionID, value, 1),
    ),
  )
}

export function broadcastUsage(
  events: EventV2.Interface,
  db: DatabaseService,
  sessionID: (typeof SessionV1.Event.MessageUpdated.Type)["data"]["sessionID"],
) {
  return Effect.gen(function* () {
    const row = yield* db
      .select()
      .from(SessionTable)
      .where(eq(SessionTable.id, sessionID))
      .get()
      .pipe(Effect.orDie)
    if (!row) return
    const info = sessionInfo(row)
    yield* events.publishLive(SessionV1.Event.Updated, { sessionID: info.id, info })
  }).pipe(Effect.catchCause(() => Effect.void))
}

function sessionInfo(row: typeof SessionTable.$inferSelect) {
  return SessionV1.SessionInfo.make({
    id: row.id,
    slug: row.slug,
    projectID: row.project_id,
    workspaceID: row.workspace_id ?? undefined,
    directory: row.directory,
    path: row.path ?? undefined,
    parentID: row.parent_id ?? undefined,
    title: row.title,
    agent: row.agent ?? undefined,
    model: row.model
      ? {
          id: ModelV2.ID.make(row.model.id),
          providerID: ProviderV2.ID.make(row.model.providerID),
          variant: row.model.variant,
        }
      : undefined,
    version: row.version,
    summary:
      row.summary_additions !== null || row.summary_deletions !== null || row.summary_files !== null
        ? {
            additions: row.summary_additions ?? 0,
            deletions: row.summary_deletions ?? 0,
            files: row.summary_files ?? 0,
            diffs: row.summary_diffs ?? undefined,
          }
        : undefined,
    cost: row.cost,
    tokens: {
      input: row.tokens_input,
      output: row.tokens_output,
      reasoning: row.tokens_reasoning,
      cache: { read: row.tokens_cache_read, write: row.tokens_cache_write },
    },
    share: row.share_url ? { url: row.share_url } : undefined,
    metadata: row.metadata ?? undefined,
    revert: row.revert
      ? {
          messageID: SessionV1.MessageID.make(row.revert.messageID),
          partID: row.revert.partID ? SessionV1.PartID.make(row.revert.partID) : undefined,
          snapshot: row.revert.snapshot,
          diff: row.revert.diff,
        }
      : undefined,
    time: {
      created: row.time_created,
      updated: row.time_updated,
      compacting: row.time_compacting ?? undefined,
      archived: row.time_archived ?? undefined,
    },
  })
}

function run(db: DatabaseService, event: SessionEvent.Event) {
  return Effect.gen(function* () {
    const decodeRow = (row: typeof SessionMessageTable.$inferSelect) =>
      decodeMessage({ ...row.data, id: row.id, type: row.type })
    const updateMessage = (message: SessionMessage.Message) => {
      if (event.durable === undefined) return Effect.die("Durable Session event is missing aggregate sequence")
      const encoded = encodeMessage(message)
      const { id, type, ...data } = encoded
      return db
        .update(SessionMessageTable)
        .set({ type, time_created: DateTime.toEpochMillis(message.time.created), data })
        .where(
          and(
            eq(SessionMessageTable.id, SessionMessage.ID.make(id)),
            eq(SessionMessageTable.session_id, event.data.sessionID),
          ),
        )
        .run()
        .pipe(Effect.orDie)
    }
    const appendMessage = (message: SessionMessage.Message) => insertMessage(db, event, message)
    const adapter: SessionMessageUpdater.Adapter = {
      getCurrentAssistant() {
        return Effect.gen(function* () {
          // A newer turn supersedes stale incomplete rows; never resume an older assistant projection.
          const row = yield* db
            .select()
            .from(SessionMessageTable)
            .where(
              and(eq(SessionMessageTable.session_id, event.data.sessionID), eq(SessionMessageTable.type, "assistant")),
            )
            .orderBy(desc(SessionMessageTable.seq))
            .limit(1)
            .get()
            .pipe(Effect.orDie)
          if (!row) return
          const message = decodeRow(row)
          return message.type === "assistant" && !message.time.completed ? message : undefined
        })
      },
      getAssistant(messageID) {
        return Effect.gen(function* () {
          const row = yield* db
            .select()
            .from(SessionMessageTable)
            .where(
              and(
                eq(SessionMessageTable.id, messageID),
                eq(SessionMessageTable.session_id, event.data.sessionID),
                eq(SessionMessageTable.type, "assistant"),
              ),
            )
            .get()
            .pipe(Effect.orDie)
          if (!row) return
          const message = decodeRow(row)
          return message.type === "assistant" ? message : undefined
        })
      },
      getCurrentShell(callID) {
        return Effect.gen(function* () {
          const rows = yield* db
            .select()
            .from(SessionMessageTable)
            .where(and(eq(SessionMessageTable.session_id, event.data.sessionID), eq(SessionMessageTable.type, "shell")))
            .orderBy(desc(SessionMessageTable.seq))
            .all()
            .pipe(Effect.orDie)
          return rows
            .map(decodeRow)
            .find((message): message is SessionMessage.Shell => message.type === "shell" && message.callID === callID)
        })
      },
      updateAssistant: updateMessage,
      updateShell: updateMessage,
      appendMessage,
    }
    yield* SessionMessageUpdater.update(adapter, event)
  })
}

/** 任务标题取用户消息的首段文本，截断在写入时完成。 */
function userTitle(message: SessionMessage.Message): string {
  const parts = (message as { parts?: ReadonlyArray<{ type?: string; text?: string }> }).parts
  for (const part of parts ?? []) {
    if (part?.type === "text" && typeof part.text === "string" && part.text.trim() !== "") return part.text.trim()
  }
  return "(空任务)"
}

function insertMessage(db: DatabaseService, event: SessionEvent.Event, message: SessionMessage.Message) {
  if (event.durable === undefined) return Effect.die("Durable Session event is missing aggregate sequence")
  const encoded = encodeMessage(message)
  const { id, type, ...data } = encoded
  return db
    .insert(SessionMessageTable)
    .values({
      id: SessionMessage.ID.make(id),
      session_id: event.data.sessionID,
      type,
      seq: event.durable.seq,
      time_created: DateTime.toEpochMillis(message.time.created),
      data,
    })
.run()
    .pipe(
      Effect.orDie,
      Effect.asVoid,
      // C-01：用户消息即一个任务的开始；先结算上一条（用户连发两条时会走到这里）
      Effect.flatMap(() =>
        message.type === "user"
          ? TaskProjector.openTask(db, event.data.sessionID, MessageID.make(id), userTitle(message))
          : Effect.void,
      ),
    )
}

const layer = Layer.effectDiscard(
  Effect.gen(function* () {
    const events = yield* EventV2.Service
    const { db } = yield* Database.Service
    yield* events.project(SessionV1.Event.Created, (event) =>
      Effect.gen(function* () {
        const stored = yield* db
          .insert(SessionTable)
          .values(sessionRow(event.data.info))
          .onConflictDoNothing()
          .returning({ sessionID: SessionTable.id })
          .get()
          .pipe(Effect.orDie)
        if (!stored) return yield* Effect.die(new SessionAlreadyProjected())
        if (event.data.info.workspaceID) {
          yield* db
            .update(WorkspaceTable)
            .set({ time_used: Date.now() })
            .where(eq(WorkspaceTable.id, event.data.info.workspaceID))
            .run()
            .pipe(Effect.orDie)
        }
      }),
    )
    yield* events.project(SessionV1.Event.Updated, (event) =>
      db
        .update(SessionTable)
        .set(sessionRow(event.data.info))
        .where(eq(SessionTable.id, event.data.sessionID))
        .run()
        .pipe(Effect.orDie),
    )
    yield* events.project(SessionEvent.Moved, (event) =>
      Effect.gen(function* () {
        yield* db
          .update(SessionTable)
          .set({
            directory: event.data.location.directory,
            path: event.data.subdirectory,
            workspace_id: event.data.location.workspaceID ? WorkspaceV2.ID.make(event.data.location.workspaceID) : null,
            time_updated: DateTime.toEpochMillis(event.data.timestamp),
          })
          .where(eq(SessionTable.id, event.data.sessionID))
          .run()
          .pipe(Effect.orDie)
        yield* SessionContextEpoch.reset(db, event.data.sessionID)
      }),
    )
    yield* events.project(SessionV1.Event.Deleted, (event) =>
      db.delete(SessionTable).where(eq(SessionTable.id, event.data.sessionID)).run().pipe(Effect.orDie),
    )
    yield* events.project(SessionV1.Event.MessageUpdated, (event) =>
      Effect.gen(function* () {
        const time_created = event.data.info.time.created
        const id = event.data.info.id
        const sessionID = event.data.info.sessionID
        const data = messageData(event.data.info)
        yield* db
          .insert(MessageTable)
          .values({ id, session_id: sessionID, time_created, data })
          .onConflictDoUpdate({ target: MessageTable.id, set: { data } })
          .run()
          .pipe(Effect.orDie)
      }),
    )
    yield* events.project(SessionV1.Event.MessageRemoved, (event) =>
      Effect.gen(function* () {
        const rows = yield* db
          .select()
          .from(PartTable)
          .where(and(eq(PartTable.message_id, event.data.messageID), eq(PartTable.session_id, event.data.sessionID)))
          .all()
          .pipe(Effect.orDie)
        for (const row of rows) {
          const previous = usage(row.data)
          // C-05: append-only, no rollback on message removal
        }
        yield* db
          .delete(MessageTable)
          .where(and(eq(MessageTable.id, event.data.messageID), eq(MessageTable.session_id, event.data.sessionID)))
          .run()
          .pipe(Effect.orDie)
      }),
    )
    yield* events.project(SessionV1.Event.PartRemoved, (event) =>
      Effect.gen(function* () {
        const row = yield* db
          .select()
          .from(PartTable)
          .where(and(eq(PartTable.id, event.data.partID), eq(PartTable.session_id, event.data.sessionID)))
          .get()
          .pipe(Effect.orDie)
        const previous = row && usage(row.data)
        // C-05: append-only, no rollback on part removal
        yield* db
          .delete(PartTable)
          .where(and(eq(PartTable.id, event.data.partID), eq(PartTable.session_id, event.data.sessionID)))
          .run()
          .pipe(Effect.orDie)
      }),
    )
    yield* events.project(SessionV1.Event.PartUpdated, (event) =>
      Effect.gen(function* () {
        const id = event.data.part.id
        const messageID = event.data.part.messageID
        const sessionID = event.data.part.sessionID
        const data = partData(event.data.part)
        const row = yield* db.select().from(PartTable).where(eq(PartTable.id, id)).get().pipe(Effect.orDie)
        yield* db
          .insert(PartTable)
          .values({ id, message_id: messageID, session_id: sessionID, time_created: event.data.time, data })
          .onConflictDoUpdate({ target: PartTable.id, set: { data } })
          .run()
          .pipe(Effect.orDie)
        const previous = row && usage(row.data)
        const next = usage(event.data.part)
        // C-05: append-only, no rollback on part update
        if (next) yield* applyUsage(db, events, sessionID, next)
        // C-05：工具失败即判本轮任务失败，并记下第一处原因。此前没有任何地方
        // 记录「这轮到底成没成」，成功率只能靠人肉回看会话。
        const part = event.data.part as {
          type?: string
          tool?: string
          state?: { status?: string; error?: string }
        }
        const partState = part.state
        if (partState?.status === "error") {
          yield* TaskProjector.recordTaskError(db, sessionID, partState.error ?? `${part.tool ?? "工具"} 执行失败`)
        }
      }),
    )
    yield* events.project(SessionEvent.AgentSwitched, (event) =>
      db
        .update(SessionTable)
        .set({ agent: event.data.agent, time_updated: DateTime.toEpochMillis(event.data.timestamp) })
        .where(eq(SessionTable.id, event.data.sessionID))
        .run()
        .pipe(Effect.orDie, Effect.andThen(run(db, event))),
    )
    yield* events.project(SessionEvent.ModelSwitched, (event) =>
      Effect.gen(function* () {
        yield* db
          .update(SessionTable)
          .set({ model: event.data.model, time_updated: DateTime.toEpochMillis(event.data.timestamp) })
          .where(eq(SessionTable.id, event.data.sessionID))
          .run()
          .pipe(Effect.orDie)
        yield* run(db, event)
      }),
    )
    yield* events.project(SessionEvent.Prompted, (event) =>
      Effect.gen(function* () {
        if (event.durable === undefined) return yield* Effect.die("Durable Session event is missing aggregate sequence")
        yield* SessionInput.projectPrompted(db, {
          id: event.data.messageID,
          sessionID: event.data.sessionID,
          prompt: event.data.prompt,
          delivery: event.data.delivery,
          timeCreated: event.data.timestamp,
          promotedSeq: event.durable.seq,
        })
        yield* run(db, event)
      }),
    )
    yield* events.project(SessionEvent.PromptAdmitted, (event) =>
      Effect.gen(function* () {
        if (event.durable === undefined) return yield* Effect.die("Durable Session event is missing aggregate sequence")
        yield* SessionInput.projectAdmitted(db, {
          admittedSeq: event.durable.seq,
          id: event.data.messageID,
          sessionID: event.data.sessionID,
          prompt: event.data.prompt,
          delivery: event.data.delivery,
          timeCreated: event.data.timestamp,
        })
      }),
    )
    yield* events.project(SessionEvent.ContextUpdated, (event) => run(db, event))
    yield* events.project(SessionEvent.Synthetic, (event) => run(db, event))
    yield* events.project(SessionEvent.Shell.Started, (event) => run(db, event))
    yield* events.project(SessionEvent.Shell.Ended, (event) => run(db, event))
    yield* events.project(SessionEvent.Step.Started, (event) => run(db, event))
    yield* events.project(SessionEvent.Step.Ended, (event) => run(db, event))
    yield* events.project(SessionEvent.Step.Failed, (event) => run(db, event))
    yield* events.project(SessionEvent.Text.Started, (event) => run(db, event))
    yield* events.project(SessionEvent.Text.Ended, (event) => run(db, event))
    yield* events.project(SessionEvent.Tool.Input.Started, (event) => run(db, event))
    yield* events.project(SessionEvent.Tool.Input.Ended, (event) => run(db, event))
    yield* events.project(SessionEvent.Tool.Called, (event) => run(db, event))
    yield* events.project(SessionEvent.Tool.Progress, (event) => run(db, event))
    yield* events.project(SessionEvent.Tool.Success, (event) => run(db, event))
    yield* events.project(SessionEvent.Tool.Failed, (event) => run(db, event))
    yield* events.project(SessionEvent.Reasoning.Started, (event) => run(db, event))
    yield* events.project(SessionEvent.Reasoning.Ended, (event) => run(db, event))
    // yield* events.project(SessionEvent.Retried, (event) => run(db, event))
    yield* events.project(SessionEvent.Compaction.Ended, (event) => run(db, event))
    yield* events.project(SessionEvent.RevertEvent.Staged, (event) =>
      db
        .update(SessionTable)
        .set({
          revert: { ...event.data.revert, files: event.data.revert.files ? [...event.data.revert.files] : undefined },
          time_updated: DateTime.toEpochMillis(event.data.timestamp),
        })
        .where(eq(SessionTable.id, event.data.sessionID))
        .run()
        .pipe(Effect.orDie, Effect.asVoid),
    )
    yield* events.project(SessionEvent.RevertEvent.Cleared, (event) =>
      db
        .update(SessionTable)
        .set({ revert: null, time_updated: DateTime.toEpochMillis(event.data.timestamp) })
        .where(eq(SessionTable.id, event.data.sessionID))
        .run()
        .pipe(Effect.orDie, Effect.asVoid),
    )
    yield* events.project(SessionEvent.RevertEvent.Committed, (event) =>
      Effect.gen(function* () {
        const boundary = yield* db
          .select({ seq: SessionMessageTable.seq })
          .from(SessionMessageTable)
          .where(
            and(
              eq(SessionMessageTable.session_id, event.data.sessionID),
              eq(SessionMessageTable.id, event.data.messageID),
            ),
          )
          .get()
          .pipe(Effect.orDie)
        if (!boundary) return yield* Effect.die(`Revert boundary message not found: ${event.data.messageID}`)
        yield* db
          .delete(SessionMessageTable)
          .where(
            and(eq(SessionMessageTable.session_id, event.data.sessionID), gt(SessionMessageTable.seq, boundary.seq)),
          )
          .run()
          .pipe(Effect.orDie)
        yield* db
          .delete(SessionInputTable)
          .where(
            and(
              eq(SessionInputTable.session_id, event.data.sessionID),
              or(gt(SessionInputTable.admitted_seq, boundary.seq), gt(SessionInputTable.promoted_seq, boundary.seq)),
            ),
          )
          .run()
          .pipe(Effect.orDie)
        yield* db
          .update(SessionTable)
          .set({ revert: null, time_updated: DateTime.toEpochMillis(event.data.timestamp) })
          .where(eq(SessionTable.id, event.data.sessionID))
          .run()
          .pipe(Effect.orDie)
        yield* SessionContextEpoch.reset(db, event.data.sessionID)
      }),
    )
  }),
)

export const node = makeGlobalNode({ name: "session-projector", layer, deps: [EventV2.node, Database.node] })
