import { FileSystem } from "@gyccode/core/filesystem"
import { RelativePath } from "@gyccode/core/schema"
import { Effect } from "effect"
import { HttpServerResponse } from "effect/unstable/http"
import { HttpApiBuilder } from "effect/unstable/httpapi"
import { Api } from "../api"
import { response } from "../location"

export const FileSystemHandler = HttpApiBuilder.group(Api, "server.fs", (handlers) =>
  Effect.gen(function* () {
    return handlers
      .handleRaw("fs.read", (ctx) =>
        Effect.gen(function* () {
          const pathname = new URL(ctx.request.url, "http://localhost").pathname
          // 路由前缀与协议声明一致（/api/fs/read/*），按前缀实际长度切分，避免改路由后硬编码长度静默截断路径
          const prefix = "/api/fs/read/"
          const file = yield* (yield* FileSystem.Service).read({
            path: RelativePath.make(
              decodeURIComponent(pathname.startsWith(prefix) ? pathname.slice(prefix.length) : pathname.slice(1)),
            ),
          })
          return HttpServerResponse.uint8Array(file.content, { contentType: file.mime })
        }),
      )
      .handle("fs.list", (ctx) =>
        response(
          Effect.gen(function* () {
            const fs = yield* FileSystem.Service
            return yield* fs.list(ctx.query)
          }),
        ),
      )
      .handle("fs.find", (ctx) =>
        response(
          Effect.gen(function* () {
            const fs = yield* FileSystem.Service
            return yield* fs.find(ctx.query)
          }),
        ),
      )
  }),
)
