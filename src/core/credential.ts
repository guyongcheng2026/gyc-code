export * as Credential from "./credential"

import { asc, eq } from "drizzle-orm"
import { Context, Effect, Layer, Schema } from "effect"
import { Credential } from "@gyccode/schema/credential"
import { Integration } from "@gyccode/schema/integration"
import { Database } from "./database/database"
import { makeGlobalNode } from "./effect/app-node"
import { CredentialTable } from "./credential/sql"
import { protectSecret, unprotectSecret } from "./util/dpapi"

export const ID = Credential.ID
export type ID = Credential.ID

export const OAuth = Credential.OAuth
export type OAuth = Credential.OAuth

export const Key = Credential.Key
export type Key = Credential.Key

export const Value = Credential.Value
export type Value = Credential.Value

export class Info extends Schema.Class<Info>("Credential.Info")({
  id: ID,
  integrationID: Integration.ID,
  label: Schema.String,
  value: Value,
}) {}

export interface Interface {
  /** Returns every stored credential. */
  readonly all: () => Effect.Effect<Info[]>
  /** Returns stored credentials belonging to one integration. */
  readonly list: (integrationID: Integration.ID) => Effect.Effect<Info[]>
  /** Returns one stored credential by ID. */
  readonly get: (id: ID) => Effect.Effect<Info | undefined>
  /** Replaces any credential for an integration and returns the new record. */
  readonly create: (input: {
    readonly integrationID: Integration.ID
    readonly value: Value
    readonly label?: string
  }) => Effect.Effect<Info>
  /** Updates the label or secret value of a stored credential. */
  readonly update: (id: ID, updates: Partial<Pick<Info, "label" | "value">>) => Effect.Effect<void>
  /** Removes a stored credential. */
  readonly remove: (id: ID) => Effect.Effect<void>
}

export class Service extends Context.Service<Service, Interface>()("@gyccode/v2/Credential") {}

const layer = Layer.effect(
  Service,
  Effect.gen(function* () {
    const { db } = yield* Database.Service
    const decode = Schema.decodeUnknownSync(Value)

    // 凭据机密字段落盘加密（win32 DPAPI，密钥绑定当前用户；其他平台恒等）。
    // 读取侧解密失败的凭据（跨账户/跨机拷贝的数据库）直接丢弃该条——
    // 返回无法通过认证的密文没有意义，用户重新登录即可恢复。
    const protectValue = (value: Credential.Value): Credential.Value => {
      if (value.type === "key") return { ...value, key: protectSecret(value.key) }
      return { ...value, refresh: protectSecret(value.refresh), access: protectSecret(value.access) }
    }
    const unprotectValue = (value: Credential.Value): Credential.Value => {
      if (value.type === "key") return { ...value, key: unprotectSecret(value.key) }
      return { ...value, refresh: unprotectSecret(value.refresh), access: unprotectSecret(value.access) }
    }

    // 解密失败的凭据 ID 收集队列：stored() 是同步函数无法直接 Effect.log，
    // 调用方在查询结束后 flush 一次 warning，保证"静默丢弃"可排障
    // （典型场景：数据库被跨机/跨账户拷贝，DPAPI 密文无法解密）。
    let decodeFailures: string[] = []
    const stored = (row: typeof CredentialTable.$inferSelect) => {
      if (!row.integration_id) return
      try {
        return new Info({
          id: row.id,
          integrationID: row.integration_id,
          label: row.label,
          value: unprotectValue(decode(row.value)),
        })
      } catch {
        decodeFailures.push(row.id)
        return undefined
      }
    }
    const flushDecodeFailures = () => {
      const ids = decodeFailures
      decodeFailures = []
      return ids.length
        ? Effect.logWarning("credential decrypt failed; dropping (re-login to restore)", { ids })
        : Effect.void
    }

    return Service.of({
      all: Effect.fn("Credential.all")(function* () {
        const rows = yield* db
          .select()
          .from(CredentialTable)
          .orderBy(asc(CredentialTable.time_created))
          .all()
          .pipe(Effect.orDie)
        const credentials = rows.flatMap((row) => {
          const credential = stored(row)
          return credential ? [credential] : []
        })
        yield* flushDecodeFailures()
        return credentials
      }),
      list: Effect.fn("Credential.list")(function* (integrationID) {
        const rows = yield* db
          .select()
          .from(CredentialTable)
          .where(eq(CredentialTable.integration_id, integrationID))
          .orderBy(asc(CredentialTable.time_created))
          .all()
          .pipe(Effect.orDie)
        const credentials = rows.flatMap((row) => {
          const credential = stored(row)
          return credential ? [credential] : []
        })
        yield* flushDecodeFailures()
        return credentials
      }),
      get: Effect.fn("Credential.get")(function* (id) {
        const row = yield* db.select().from(CredentialTable).where(eq(CredentialTable.id, id)).get().pipe(Effect.orDie)
        const credential = row ? stored(row) : undefined
        yield* flushDecodeFailures()
        return credential
      }),
      create: Effect.fn("Credential.create")(function* (input) {
        const credential = new Info({
          id: ID.create(),
          integrationID: input.integrationID,
          label: input.label ?? "default",
          value: input.value,
        })
        yield* db
          .transaction((tx) =>
            Effect.gen(function* () {
              yield* tx
                .delete(CredentialTable)
                .where(eq(CredentialTable.integration_id, credential.integrationID))
                .run()
              yield* tx
                .insert(CredentialTable)
                .values({
                  id: credential.id,
                  integration_id: credential.integrationID,
                  label: credential.label,
                  value: protectValue(credential.value),
                })
                .run()
            }),
          )
          .pipe(Effect.orDie)
        return credential
      }),
      update: Effect.fn("Credential.update")(function* (id, updates) {
        if (!updates.label && !updates.value) return
        yield* db
          .update(CredentialTable)
          .set({
            label: updates.label,
            value: updates.value === undefined ? undefined : protectValue(updates.value),
          })
          .where(eq(CredentialTable.id, id))
          .run()
          .pipe(Effect.orDie)
      }),
      remove: Effect.fn("Credential.remove")(function* (id) {
        yield* db.delete(CredentialTable).where(eq(CredentialTable.id, id)).run().pipe(Effect.orDie)
      }),
    })
  }),
)

export const node = makeGlobalNode({ service: Service, layer, deps: [Database.node] })
