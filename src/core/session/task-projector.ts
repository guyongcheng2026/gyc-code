/**
 * task 投影，2026-09-30 补齐任务真实成本（P0）与 C-01、C-05。
 *
 * 在此之前成本只有会话与消息两个粒度，「完成一个 feature 花了多少钱」算不出来；
 * 也没有任何地方记录一个任务到底成没成。这里补上第三个粒度：
 *
 * - **切分**：一个 task = 一个用户轮次。收到用户消息时开；若上一个 task 还开着
 *   （例如用户连发两条），先结算再开新的。
 * - **计价**：usage 落到会话时，同一份增量同时累加到该会话当前打开的 task，
 *   口径与 SessionTable 完全同源，所以 `gyc task list` 与 `gyc stats` 对得上。
 * - **成败**：该轮出现 error part 即判 failed，并记下第一条错误标题（C-05）。
 *
 * 历史会话不追溯：投影只对迁移之后的新事件生效。
 */
import { and, desc, eq, sql } from "drizzle-orm"
import { Effect } from "effect"
import * as Identifier from "../id/id"
import { TaskTable, SessionTable } from "./sql"
import type { Database } from "../database/database"
import type { SessionSchema } from "./schema"
import type { MessageID } from "../v1/session"

type Usage = {
  cost: number
  tokens: { input: number; output: number; reasoning: number; cache: { read: number; write: number } }
}

type DB = Database.Interface["db"]

const runningTask = (db: DB, sessionID: SessionSchema.ID) =>
  db
    .select()
    .from(TaskTable)
    .where(and(eq(TaskTable.session_id, sessionID), eq(TaskTable.status, "running")))
    .orderBy(desc(TaskTable.time_created))
    .get()
    .pipe(Effect.orDie)

const addUsage = (db: DB, id: string, value: Usage) =>
  db
    .update(TaskTable)
    .set({
      cost: sql`${TaskTable.cost} + ${value.cost}`,
      tokens_input: sql`${TaskTable.tokens_input} + ${value.tokens.input}`,
      tokens_output: sql`${TaskTable.tokens_output} + ${value.tokens.output + value.tokens.reasoning}`,
      tokens_cache_read: sql`${TaskTable.tokens_cache_read} + ${value.tokens.cache.read}`,
      tokens_cache_write: sql`${TaskTable.tokens_cache_write} + ${value.tokens.cache.write}`,
      time_updated: sql`${TaskTable.time_updated}`,
    })
    .where(eq(TaskTable.id, id))
    .run()
    .pipe(Effect.orDie, Effect.asVoid)

/** 结算当前打开的 task。status 由调用方给出（依据是该轮是否出现 error part）。 */
export function settleTask(
  db: DB,
  sessionID: SessionSchema.ID,
  status: "success" | "failed",
  error?: string,
) {
  return runningTask(db, sessionID).pipe(
    Effect.flatMap((task) => {
      if (!task) return Effect.void
      return Effect.gen(function* () {
        const session = yield* db
          .select({ cost: SessionTable.cost })
          .from(SessionTable)
          .where(eq(SessionTable.id, sessionID))
          .get()
          .pipe(Effect.orDie)
        const sessionCost = session?.cost ?? 0
        const taskCost = Math.max(0, sessionCost - (task.start_cost ?? 0))
        yield* db
          .update(TaskTable)
          .set({
            status,
            error: error ?? task.error ?? null,
            cost: taskCost,
            time_completed: Date.now(),
            time_updated: sql`${TaskTable.time_updated}`,
          })
          .where(eq(TaskTable.id, task.id))
          .run()
          .pipe(Effect.orDie)
      })
    }),
  )
}

/** 收到用户消息：先结算上一条，再开新的一条。 */
export function openTask(db: DB, sessionID: SessionSchema.ID, messageID: MessageID, title: string) {
  return settleTask(db, sessionID, "success").pipe(
    Effect.andThen(() =>
      Effect.gen(function* () {
        const session = yield* db
          .select({ cost: SessionTable.cost })
          .from(SessionTable)
          .where(eq(SessionTable.id, sessionID))
          .get()
          .pipe(Effect.orDie)
        const startCost = session?.cost ?? 0
        yield* db
          .insert(TaskTable)
          .values({
            id: Identifier.create("task", "descending"),
            session_id: sessionID,
            message_id: messageID,
            title: title.slice(0, 200),
            status: "running",
            start_cost: startCost,
            cost: 0,
            tokens_input: 0,
            tokens_output: 0,
            tokens_cache_read: 0,
            tokens_cache_write: 0,
            time_created: Date.now(),
            time_updated: Date.now(),
            time_completed: null,
          })
          .run()
          .pipe(Effect.orDie)
      }),
    ),
  )
}

/** usage 增量同时落到当前 task；没有打开的 task 则忽略（历史会话不追溯）。 */
export function applyTaskUsage(db: DB, sessionID: SessionSchema.ID, value: Usage, sign: number) {
  // C-05: append-only, always positive increment
  return runningTask(db, sessionID).pipe(
    Effect.flatMap((task) => (task ? addUsage(db, task.id, value) : Effect.void)),
  )
}

/** 该轮出现 error part：记下第一处失败原因，并把 task 判为 failed。 */
export function recordTaskError(db: DB, sessionID: SessionSchema.ID, error: string) {
  return runningTask(db, sessionID).pipe(
    Effect.flatMap((task) => {
      if (!task) return Effect.void
      return db
        .update(TaskTable)
        .set({
          status: "failed",
          error: task.error ?? error.slice(0, 500),
          time_updated: sql`${TaskTable.time_updated}`,
        })
        .where(eq(TaskTable.id, task.id))
        .run()
        .pipe(Effect.orDie, Effect.asVoid)
    }),
  )
}

/** 列出某会话（或全部）的 task，供 `gyc task list` 使用。 */
export function listTasks(db: DB, sessionID?: SessionSchema.ID) {
  const base = db.select().from(TaskTable)
  const query = sessionID ? base.where(eq(TaskTable.session_id, sessionID)) : base
  return query.orderBy(desc(TaskTable.time_created)).all().pipe(Effect.orDie)
}

/** 尚未结算的 task 数量，供会话结束/健康检查使用。 */
export function countRunning(db: DB, sessionID: SessionSchema.ID) {
  return db
    .select()
    .from(TaskTable)
    .where(and(eq(TaskTable.session_id, sessionID), eq(TaskTable.status, "running")))
    .all()
    .pipe(Effect.orDie, Effect.map((rows) => rows.length))
}
