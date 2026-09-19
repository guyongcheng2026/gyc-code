import { LayerNode } from "@gyccode/core/effect/layer-node"
import path from "path"
import { Effect, Layer, Record, Result, Schema, Context } from "effect"
import { NonNegativeInt } from "@gyccode/core/schema"
import { Global } from "@gyccode/core/global"
import { FSUtil } from "@gyccode/core/fs-util"
import { Credential } from "@gyccode/core/credential"
import { Integration } from "@gyccode/schema/integration"

export const OAUTH_DUMMY_KEY = "gyccode-oauth-dummy-key"

const file = path.join(Global.Path.data, "auth.json")

const fail = (message: string) => (cause: unknown) => new AuthError({ message, cause })

export class Oauth extends Schema.Class<Oauth>("OAuth")({
  type: Schema.Literal("oauth"),
  refresh: Schema.String,
  access: Schema.String,
  expires: NonNegativeInt,
  accountId: Schema.optional(Schema.String),
  enterpriseUrl: Schema.optional(Schema.String),
}) {}

export class Api extends Schema.Class<Api>("ApiAuth")({
  type: Schema.Literal("api"),
  key: Schema.String,
  metadata: Schema.optional(Schema.Record(Schema.String, Schema.String)),
}) {}

export class WellKnown extends Schema.Class<WellKnown>("WellKnownAuth")({
  type: Schema.Literal("wellknown"),
  key: Schema.String,
  token: Schema.String,
}) {}

export const Info = Schema.Union([Oauth, Api, WellKnown]).annotate({ discriminator: "type", identifier: "Auth" })
export type Info = Schema.Schema.Type<typeof Info>

export class AuthError extends Schema.TaggedErrorClass<AuthError>()("AuthError", {
  message: Schema.String,
  cause: Schema.optional(Schema.Defect()),
}) {}

export interface Interface {
  readonly get: (providerID: string) => Effect.Effect<Info | undefined, AuthError>
  readonly all: () => Effect.Effect<Record<string, Info>, AuthError>
  readonly set: (key: string, info: Info) => Effect.Effect<void, AuthError>
  readonly remove: (key: string) => Effect.Effect<void, AuthError>
}

export class Service extends Context.Service<Service, Interface>()("@gyccode/Auth") {}

const layer = Layer.effect(
  Service,
  Effect.gen(function* () {
    const fsys = yield* FSUtil.Service
    const credentials = yield* Credential.Service
    const decode = Schema.decodeUnknownOption(Info)

    const all = Effect.fn("Auth.all")(function* () {
      // auth.json 读取失败（文件缺失 / JSON 损坏 / 权限不足）不再完全静默：
      // 记录告警后再按空表降级（首次运行文件不存在属正常路径），
      // 否则上层 set/remove 会以「空数据 + 单条新条目」覆写整文件，其它供应商凭据被无提示清除。
      const data = (yield* fsys.readJson(file).pipe(
        Effect.tapError((error) => Effect.logWarning("Failed to read auth data", error)),
        Effect.orElseSucceed(() => ({})),
      )) as Record<string, unknown>
      const result = Record.filterMap(data, (value) => Result.fromOption(decode(value), () => undefined))
      // 解码失败的条目会被丢掉，而 set/remove 会按这份结果整文件覆写：
      // 先把被丢弃的 key 报出来，避免其它供应商凭据被无声清除。
      const dropped = Object.keys(data).filter((key) => !(key in result))
      if (dropped.length > 0) yield* Effect.logWarning("Dropped undecodable auth entries", { keys: dropped })
      return result
    })

    const get = Effect.fn("Auth.get")(function* (providerID: string) {
      return (yield* all())[providerID]
    })

    const set = Effect.fn("Auth.set")(function* (key: string, info: Info) {
      const norm = key.replace(/\/+$/, "")
      const data = yield* all()
      if (norm !== key) delete data[key]
      delete data[norm + "/"]
      yield* fsys
        .writeJson(file, { ...data, [norm]: info }, 0o600)
        .pipe(Effect.mapError(fail("Failed to write auth data")))
      if (info.type === "api") {
        yield* credentials.create({
          integrationID: Integration.ID.make(norm),
          value: Credential.Key.make({
            type: "key",
            key: info.key,
            ...(info.metadata ? { metadata: info.metadata } : {}),
          }),
          label: "default",
        })
      }
    })

    const remove = Effect.fn("Auth.remove")(function* (key: string) {
      const norm = key.replace(/\/+$/, "")
      const data = yield* all()
      delete data[key]
      delete data[norm]
      yield* fsys.writeJson(file, data, 0o600).pipe(Effect.mapError(fail("Failed to write auth data")))
      const stored = yield* credentials.list(Integration.ID.make(norm))
      for (const credential of stored) {
        yield* credentials.remove(credential.id)
      }
    })

    return Service.of({ get, all, set, remove })
  }),
)

export const node = LayerNode.make({ service: Service, layer: layer, deps: [FSUtil.node, Credential.node] })

export * as Auth from "."
