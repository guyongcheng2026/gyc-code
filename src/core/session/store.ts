export * as SessionStore from "./store"

import { eq } from "drizzle-orm"
import { Context, Effect, Layer, Schema } from "effect"
import { Database } from "../database/database"
import { makeGlobalNode } from "../effect/app-node"
import { SessionHistory } from "./history"
import { MessageDecodeError } from "./error"
import { SessionMessage } from "./message"
import { SessionSchema } from "./schema"
import { SessionMessageTable, SessionTable } from "./sql"
import { fromRow } from "./info"

export interface Interface {
  readonly get: (sessionID: SessionSchema.ID) => Effect.Effect<SessionSchema.Info | undefined>
  readonly context: (sessionID: SessionSchema.ID) => Effect.Effect<SessionMessage.Message[], MessageDecodeError>
  readonly runnerContext: (
    sessionID: SessionSchema.ID,
    baselineSeq: number,
  ) => Effect.Effect<SessionMessage.Message[], MessageDecodeError>
  readonly message: (
    messageID: SessionMessage.ID,
  ) => Effect.Effect<{ readonly sessionID: SessionSchema.ID; readonly message: SessionMessage.Message } | undefined>
  readonly costStats: () => Effect.Effect<{
    readonly totalCost: number
    readonly totalTokens: { input: number; output: number; reasoning: number }
    readonly sessionCount: number
    readonly byModel: Record<string, { cost: number; tokens: number }>
  }>
}

export class Service extends Context.Service<Service, Interface>()("@gyccode/v2/SessionStore") {}

const layer = Layer.effect(
  Service,
  Effect.gen(function* () {
    const { db } = yield* Database.Service
    const decodeMessage = Schema.decodeUnknownEffect(SessionMessage.Message)

    return Service.of({
      get: Effect.fn("SessionStore.get")(function* (sessionID) {
        const row = yield* db.select().from(SessionTable).where(eq(SessionTable.id, sessionID)).get().pipe(Effect.orDie)
        return row ? fromRow(row) : undefined
      }),
      context: Effect.fn("SessionStore.context")(function* (sessionID) {
        return yield* SessionHistory.load(db, sessionID)
      }),
      runnerContext: Effect.fn("SessionStore.runnerContext")(function* (sessionID, baselineSeq) {
        return yield* SessionHistory.loadForRunner(db, sessionID, baselineSeq)
      }),
      message: Effect.fn("SessionStore.message")(function* (messageID) {
        const row = yield* db
          .select()
          .from(SessionMessageTable)
          .where(eq(SessionMessageTable.id, messageID))
          .get()
          .pipe(Effect.orDie)
        return row
          ? {
              sessionID: SessionSchema.ID.make(row.session_id),
              message: yield* decodeMessage({ ...row.data, id: row.id, type: row.type }).pipe(Effect.orDie),
            }
          : undefined
      }),
      costStats: Effect.fn("SessionStore.costStats")(function* () {
        const rows = yield* db
          .select({
            cost: SessionTable.cost,
            tokens_input: SessionTable.tokens_input,
            tokens_output: SessionTable.tokens_output,
            tokens_reasoning: SessionTable.tokens_reasoning,
            model: SessionTable.model,
          })
          .from(SessionTable)
          .all()
          .pipe(Effect.orDie)

        let totalCost = 0
        let totalInput = 0
        let totalOutput = 0
        let totalReasoning = 0
        const byModel: Record<string, { cost: number; tokens: number }> = {}

        for (const row of rows) {
          totalCost += row.cost ?? 0
          totalInput += row.tokens_input ?? 0
          totalOutput += row.tokens_output ?? 0
          totalReasoning += row.tokens_reasoning ?? 0

          const model = row.model as { providerID?: string; id?: string } | null
          const modelKey = model?.providerID && model.id ? `${model.providerID}/${model.id}` : "unknown"
          if (!byModel[modelKey]) byModel[modelKey] = { cost: 0, tokens: 0 }
          byModel[modelKey].cost += row.cost ?? 0
          byModel[modelKey].tokens += (row.tokens_input ?? 0) + (row.tokens_output ?? 0) + (row.tokens_reasoning ?? 0)
        }

        return {
          totalCost,
          totalTokens: { input: totalInput, output: totalOutput, reasoning: totalReasoning },
          sessionCount: rows.length,
          byModel,
        }
      }),
    })
  }),
)

export const node = makeGlobalNode({ service: Service, layer, deps: [Database.node] })
