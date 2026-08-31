import { Catalog } from "@gyccode/core/catalog"
import { Effect } from "effect"
import { HttpApiBuilder } from "effect/unstable/httpapi"
import { Api } from "../api"
import { ProviderNotFoundError } from "@gyccode/protocol/errors"
import { response } from "../location"

// 数据安全：Provider 运行时对象可能携带配置注入的明文 API Key（key 字段，
// 不在 Provider.Info schema 声明内）。该字段禁止经 HTTP 对外返回。
function redactKey<T>(provider: T): T {
  const clone = { ...(provider as Record<string, unknown>) }
  delete clone["key"]
  return clone as T
}

export const ProviderHandler = HttpApiBuilder.group(Api, "server.provider", (handlers) =>
  Effect.gen(function* () {
    return handlers
      .handle(
        "provider.list",
        Effect.fn(function* () {
          const catalog = yield* Catalog.Service
          const providers = yield* catalog.provider.available()
          return yield* response(Effect.succeed(providers.map(redactKey)))
        }),
      )
      .handle(
        "provider.get",
        Effect.fn(function* (ctx) {
          const catalog = yield* Catalog.Service
          const provider = yield* catalog.provider.get(ctx.params.providerID)
          if (!provider)
            return yield* new ProviderNotFoundError({
              providerID: ctx.params.providerID,
              message: `Provider not found: ${ctx.params.providerID}`,
            })
          return yield* response(Effect.succeed(redactKey(provider)))
        }),
      )
  }),
)
