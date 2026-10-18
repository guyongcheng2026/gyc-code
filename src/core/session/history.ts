import { and, asc, desc, eq, gt, gte, ne, or } from "drizzle-orm"
import { Effect, Schema } from "effect"
import { Database } from "../database/database"
import { MessageDecodeError } from "./error"
import { SessionMessage } from "./message"
import { SessionSchema } from "./schema"
import { SessionContextEpochTable, SessionMessageTable } from "./sql"

type DatabaseService = Database.Interface["db"]

const decode = Schema.decodeUnknownEffect(SessionMessage.Message)

export const latestCompaction = Effect.fnUntraced(function* (db: DatabaseService, sessionID: SessionSchema.ID) {
  return yield* db
    .select({ seq: SessionMessageTable.seq })
    .from(SessionMessageTable)
    .where(and(eq(SessionMessageTable.session_id, sessionID), eq(SessionMessageTable.type, "compaction")))
    .orderBy(desc(SessionMessageTable.seq))
    .limit(1)
    .get()
    .pipe(Effect.orDie)
})

const messageRows = Effect.fnUntraced(function* (
  db: DatabaseService,
  sessionID: SessionSchema.ID,
  compaction: { readonly seq: number } | undefined,
  baselineSeq?: number,
) {
  const rows = yield* db
    .select()
    .from(SessionMessageTable)
    .where(
      and(
        eq(SessionMessageTable.session_id, sessionID),
        compaction
          ? or(
              gte(SessionMessageTable.seq, compaction.seq),
              baselineSeq === undefined
                ? undefined
                : and(eq(SessionMessageTable.type, "system"), gt(SessionMessageTable.seq, baselineSeq)),
            )
          : undefined,
        baselineSeq === undefined
          ? undefined
          : or(ne(SessionMessageTable.type, "system"), gt(SessionMessageTable.seq, baselineSeq)),
      ),
    )
    .orderBy(asc(SessionMessageTable.seq))
    .all()
    .pipe(Effect.orDie)
  return rows
})

const decodeMessageRow = (row: typeof SessionMessageTable.$inferSelect) =>
  decode({ ...row.data, id: row.id, type: row.type }).pipe(
    Effect.mapError(
      () =>
        new MessageDecodeError({
          sessionID: SessionSchema.ID.make(row.session_id),
          messageID: SessionMessage.ID.make(row.id),
        }),
    ),
  )

export const load = Effect.fn("SessionHistory.load")(function* (db: DatabaseService, sessionID: SessionSchema.ID) {
  const [epoch, compaction] = yield* Effect.all(
    [
      db
        .select({ baselineSeq: SessionContextEpochTable.baseline_seq })
        .from(SessionContextEpochTable)
        .where(eq(SessionContextEpochTable.session_id, sessionID))
        .get()
        .pipe(Effect.orDie),
      latestCompaction(db, sessionID),
    ],
    { concurrency: "unbounded" },
  )
  const messages = yield* Effect.forEach(yield* messageRows(db, sessionID, compaction, epoch?.baselineSeq), decodeMessageRow)
  reconcileInterruptedTools(messages)
  return messages
})

export const loadForRunner = Effect.fn("SessionHistory.loadForRunner")(function* (
  db: DatabaseService,
  sessionID: SessionSchema.ID,
  baselineSeq: number,
) {
  return (yield* entriesForRunner(db, sessionID, baselineSeq)).map((entry) => entry.message)
})

export const entriesForRunner = Effect.fn("SessionHistory.entriesForRunner")(function* (
  db: DatabaseService,
  sessionID: SessionSchema.ID,
  baselineSeq: number,
) {
  const rows = yield* messageRows(db, sessionID, yield* latestCompaction(db, sessionID), baselineSeq)
  return yield* Effect.forEach(rows, (row) =>
    decodeMessageRow(row).pipe(
      Effect.map((message) => {
        reconcileInterruptedTools([message])
        return { seq: row.seq, message }
      }),
    ),
  )
})

// U-3：进程被 SIGKILL 后 tool part 会永远停留在 running/pending，
// 会话加载出口统一对账为 error（仅内存视图，不回写 DB，避免与活跃会话竞态）。
const INTERRUPTED_TOOL_ERROR = "进程中断：启动对账将未完成的工具状态标记为 error"

// effect Schema 解码产物属性为 readonly（仅编译期），运行时是可变普通对象；
// 对账需要定点改写 state，用映射类型去除 readonly。
type WritableToolPart = { -readonly [K in keyof SessionMessage.AssistantTool]: SessionMessage.AssistantTool[K] }

export function reconcileInterruptedTools(messages: SessionMessage.Message[]): number {
  let changed = 0
  for (const msg of messages) {
    if (msg.type !== "assistant") continue
    for (const part of msg.content) {
      if (part.type !== "tool") continue
      const state = part.state
      if (state.status !== "running" && state.status !== "pending") continue
      // 解码产物类型为 readonly，运行时是可变普通对象，此处定点改写
      const writable = part as WritableToolPart
      writable.state =
        state.status === "running"
          ? { status: "error", input: state.input, content: state.content, structured: state.structured, error: { type: "unknown", message: INTERRUPTED_TOOL_ERROR } }
          : { status: "error", input: {}, content: [], structured: { rawInput: state.input }, error: { type: "unknown", message: INTERRUPTED_TOOL_ERROR } }
      changed++
    }
  }
  return changed
}

export * as SessionHistory from "./history"
