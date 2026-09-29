import path from "path"
import { Context, Duration, Effect, Layer, Option, Schedule, Schema } from "effect"
import { FetchHttpClient, HttpClient, HttpClientRequest } from "effect/unstable/http"
import { ModelsDev } from "@gyccode/schema/models-dev"
import { Global } from "./global"
import { Flag } from "./flag/flag"
import { Flock } from "./util/flock"
import { Hash } from "./util/hash"
import { FSUtil } from "./fs-util"
import { InstallationChannel, InstallationVersion } from "./installation/version"
import { EventV2 } from "./event"
import { makeGlobalNode } from "./effect/app-node"
import { httpClient } from "./effect/app-node-platform"

export const CatalogModelStatus = Schema.Literals(["alpha", "beta", "deprecated"])
export type CatalogModelStatus = typeof CatalogModelStatus.Type

const InterleavedField = Schema.Union([
  Schema.Literals(["reasoning", "reasoning_content", "reasoning_text"]),
  Schema.String,
])

const USER_AGENT = `gyccode/${InstallationChannel}/${InstallationVersion}/${Flag.GYCCODE_CLIENT}`

const CostTier = Schema.Struct({
  input: Schema.Finite,
  output: Schema.Finite,
  cache_read: Schema.optional(Schema.Finite),
  cache_write: Schema.optional(Schema.Finite),
  tier: Schema.Struct({
    type: Schema.Literal("context"),
    size: Schema.Finite,
  }),
})

const Cost = Schema.Struct({
  input: Schema.Finite,
  output: Schema.Finite,
  cache_read: Schema.optional(Schema.Finite),
  cache_write: Schema.optional(Schema.Finite),
  tiers: Schema.optional(Schema.Array(CostTier)),
  context_over_200k: Schema.optional(
    Schema.Struct({
      input: Schema.Finite,
      output: Schema.Finite,
      cache_read: Schema.optional(Schema.Finite),
      cache_write: Schema.optional(Schema.Finite),
    }),
  ),
})

const ReasoningOption = Schema.Union([
  Schema.Struct({
    type: Schema.Literal("effort"),
    values: Schema.Array(Schema.NullOr(Schema.String)),
  }),
  Schema.Struct({
    type: Schema.Literal("toggle"),
  }),
  Schema.Struct({
    type: Schema.Literal("budget_tokens"),
    min: Schema.optional(Schema.Finite),
    max: Schema.optional(Schema.Finite),
  }),
])

export const Model = Schema.Struct({
  id: Schema.String,
  name: Schema.String,
  family: Schema.optional(Schema.String),
  release_date: Schema.String,
  attachment: Schema.Boolean,
  reasoning: Schema.Boolean,
  temperature: Schema.Boolean,
  tool_call: Schema.Boolean,
  reasoning_options: Schema.optional(Schema.Array(ReasoningOption)),
  interleaved: Schema.optional(
    Schema.Union([
      Schema.Boolean,
      InterleavedField,
      Schema.Struct({
        field: InterleavedField,
      }),
    ]),
  ),
  cost: Schema.optional(Cost),
  limit: Schema.Struct({
    context: Schema.Finite,
    input: Schema.optional(Schema.Finite),
    output: Schema.Finite,
  }),
  modalities: Schema.optional(
    Schema.Struct({
      input: Schema.Array(Schema.Literals(["text", "audio", "image", "video", "pdf"])),
      output: Schema.Array(Schema.Literals(["text", "audio", "image", "video", "pdf"])),
    }),
  ),
  experimental: Schema.optional(
    Schema.Struct({
      modes: Schema.optional(
        Schema.Record(
          Schema.String,
          Schema.Struct({
            cost: Schema.optional(Cost),
            provider: Schema.optional(
              Schema.Struct({
                body: Schema.optional(Schema.Record(Schema.String, Schema.MutableJson)),
                headers: Schema.optional(Schema.Record(Schema.String, Schema.String)),
              }),
            ),
          }),
        ),
      ),
    }),
  ),
  status: Schema.optional(CatalogModelStatus),
  provider: Schema.optional(
    Schema.Struct({ npm: Schema.optional(Schema.String), api: Schema.optional(Schema.String) }),
  ),
})
export type Model = Schema.Schema.Type<typeof Model>

export const Provider = Schema.Struct({
  api: Schema.optional(Schema.String),
  name: Schema.String,
  env: Schema.Array(Schema.String),
  id: Schema.String,
  npm: Schema.optional(Schema.String),
  models: Schema.Record(Schema.String, Model),
})

export type Provider = Schema.Schema.Type<typeof Provider>

export const Event = ModelsDev.Event

declare const GYCCODE_MODELS_DEV: Record<string, Provider> | undefined

export interface Interface {
  readonly get: () => Effect.Effect<Record<string, Provider>>
  readonly refresh: (force?: boolean) => Effect.Effect<void>
}

export class Service extends Context.Service<Service, Interface>()("@gyccode/ModelsDev") {}

const layer = Layer.effect(
  Service,
  Effect.gen(function* () {
    const fs = yield* FSUtil.Service
    const events = yield* EventV2.Service
    const http = HttpClient.filterStatusOk(
      (yield* HttpClient.HttpClient).pipe(
        HttpClient.retryTransient({
          retryOn: "errors-and-responses",
          times: 2,
          schedule: Schedule.exponential(200).pipe(Schedule.jittered),
        }),
      ),
    )

    // 模型目录数据源（公共中立模型清单 JSON，非品牌服务；可 GYCCODE_MODELS_URL 指向自建镜像）
    const source = Flag.GYCCODE_MODELS_URL || "https://models.opencode.ai"
    const filepath = path.join(
      Global.Path.cache,
      source === "https://models.opencode.ai" ? "models.json" : `models-${Hash.fast(source)}.json`,
    )
    // TTL 5min：对齐 opencode 定价缓存策略，确保价格变动（如模型降价/调价）即时生效，
    // 避免按旧价计费。上游 models.dev 本身已是小时级更新频率，5min 冗余刷新
    // 的成本（~1KB 条件 GET）远低于按旧价多扣费的风险。
    // 超 200K context 分级定价、免费模型策略等高价值信息均来自此数据源。
    // 强制刷新走 `gyc models --refresh`。
    const ttl = Duration.minutes(5)
    // 读/写/新鲜度/文件锁必须指向同一个路径：此前读走 GYCCODE_MODELS_PATH、
    // 写却固定落 filepath，导致用户自定义清单永远读不到刷新结果（永远不更新）。
    const readPath = Flag.GYCCODE_MODELS_PATH ?? filepath
    const lockKey = `models-dev:${readPath}`

    const fresh = Effect.fnUntraced(function* () {
      const stat = yield* fs.stat(readPath).pipe(Effect.catch(() => Effect.succeed(undefined)))
      if (!stat) return false
      const mtime = Option.getOrElse(stat.mtime, () => new Date(0)).getTime()
      return Date.now() - mtime < Duration.toMillis(ttl)
    })

    const fetchApi = Effect.fn("ModelsDev.fetchApi")(function* () {
      return yield* HttpClientRequest.get(`${source}/api.json`).pipe(
        HttpClientRequest.setHeader("User-Agent", USER_AGENT),
        http.execute,
        Effect.flatMap((res) => res.text),
        Effect.timeout("10 seconds"),
      )
    })

    const loadFromDisk = fs.readJson(readPath).pipe(
      Effect.catch((error) => {
        if (
          Flag.GYCCODE_MODELS_PATH === undefined &&
          error._tag === "FileSystemError" &&
          error.method === "readJson"
        ) {
          return fs.remove(readPath, { force: true }).pipe(Effect.ignore, Effect.as(undefined))
        }
        return Effect.succeed(undefined)
      }),
      Effect.map((v) => {
        // 磁盘缓存可能是空对象或半截数据，只有非空对象才算有效，否则回退快照
        if (v === null || typeof v !== "object" || Array.isArray(v) || Object.keys(v).length === 0) return undefined
        return v as Record<string, Provider>
      }),
    )

    const loadSnapshot = Effect.gen(function* () {
      if (typeof GYCCODE_MODELS_DEV !== "undefined") return GYCCODE_MODELS_DEV
      // Dynamic import keeps the 739KB snapshot out of the eager module graph
      // (sync mkdir-level TLA cost is non-trivial for short-lived commands like
      // `gyc --version`). Effect-level laziness preserves the disk → snapshot
      // → fetch fallback chain.
      const mod = yield* Effect.promise(() => import("./models-dev-snapshot"))
      return mod.MODELS_DEV_SNAPSHOT as Record<string, Provider>
    })

    const fetchAndWrite = Effect.fn("ModelsDev.fetchAndWrite")(function* () {
      const text = yield* fetchApi()
      // 先校验再落盘，避免上游返回空数据/非法 JSON 时污染缓存（下次启动拿到空模型列表）
      let parsed: unknown
      try {
        parsed = JSON.parse(text)
      } catch (cause) {
        return yield* Effect.fail(new Error(`models.dev 返回非法 JSON，跳过写入缓存: ${String(cause)}`))
      }
      if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed) || Object.keys(parsed).length === 0)
        return yield* Effect.fail(new Error("models.dev 返回空模型清单，跳过写入缓存"))
      const tempfile = `${readPath}.${process.pid}.${Date.now()}.tmp`
      yield* fs.writeWithDirs(tempfile, text).pipe(
        Effect.andThen(fs.rename(tempfile, readPath)),
        Effect.catch((error) =>
          Effect.gen(function* () {
            yield* fs.remove(tempfile, { force: true }).pipe(Effect.ignore)
            return yield* Effect.fail(error)
          }),
        ),
      )
      return text
    })

    const populate = Effect.gen(function* () {
      const fromDisk = yield* loadFromDisk
      if (fromDisk) return fromDisk
      const snapshot = yield* loadSnapshot
      if (snapshot) return snapshot
      if (Flag.GYCCODE_DISABLE_MODELS_FETCH) return {}
      // Flock is cross-process: concurrent gyccode CLIs can race on this cache file.
      const text = yield* Effect.scoped(
        Effect.gen(function* () {
          yield* Flock.effect(lockKey)
          return yield* fetchAndWrite()
        }),
      ).pipe(
        // 回源失败同样要落失败标记：populate 是「磁盘无缓存且快照缺失」时的唯一路径，
        // 此前只有 refresh 写标记，导致这条路径每次调用都空转 10s 超时 + 2 次重试。
        Effect.tapCause((cause) =>
          Effect.gen(function* () {
            yield* Effect.logError("Failed to populate models.dev cache", { cause: cause })
            yield* fs.writeFileString(failureMarker, String(Date.now())).pipe(Effect.ignore)
          }),
        ),
      )
      return JSON.parse(text) as Record<string, Provider>
    }).pipe(Effect.withSpan("ModelsDev.populate"), Effect.orDie)

    const [cachedGet, invalidate] = yield* Effect.cachedInvalidateWithTTL(populate, Duration.infinity)

    const get = (): Effect.Effect<Record<string, Provider>> => cachedGet

    // 失败退避：网络不可达时每次启动都会空转 10s 超时 + 重试。用失败标记文件
    // 跨进程记录，30 分钟内跳过自动刷新（force=true 的手动刷新不受限）。
    const failureMarker = `${filepath}.failed`
    const backoffMs = Duration.toMillis(Duration.minutes(30))
    const recentlyFailed = Effect.fnUntraced(function* () {
      const stat = yield* fs.stat(failureMarker).pipe(Effect.catch(() => Effect.succeed(undefined)))
      if (!stat) return false
      const mtime = Option.getOrElse(stat.mtime, () => new Date(0)).getTime()
      return Date.now() - mtime < backoffMs
    })

    const refresh = Effect.fn("ModelsDev.refresh")(function* (force = false) {
      if (!force && (yield* fresh())) return
      if (!force && (yield* recentlyFailed())) return
      yield* Effect.scoped(
        Effect.gen(function* () {
          yield* Flock.effect(lockKey)
          // Re-check under the lock: another process may have refreshed between
          // our outer check and lock acquisition.
          if (!force && ((yield* fresh()) || (yield* recentlyFailed()))) return
          yield* fetchAndWrite()
          yield* invalidate
          yield* events.publish(Event.Refreshed, {})
          yield* fs.remove(failureMarker, { force: true }).pipe(Effect.ignore)
        }),
      ).pipe(
        Effect.tapCause((cause) =>
          Effect.gen(function* () {
            yield* Effect.logError("Failed to fetch models.dev", { cause: cause })
            yield* fs.writeFileString(failureMarker, String(Date.now())).pipe(Effect.ignore)
          }),
        ),
        Effect.ignore,
      )
    })

    if (!Flag.GYCCODE_DISABLE_MODELS_FETCH && !process.argv.includes("--get-yargs-completions")) {
      // Schedule.spaced runs the effect once, then waits between completions.
      // 不先延迟的话，缓存超 5min 的冷启动会在进程刚起来就发起 8.2MB 拉取
      // （10s 超时 + 2 次重试），与用户的首个 LLM 请求抢同一个 FetchHttpClient，
      // 直接推高「请求 → 首条回复」延时。先静默 1min 再进入 10min 周期。
      yield* Effect.forkScoped(
        Effect.andThen(Effect.sleep("1 minute"), refresh()).pipe(
          Effect.repeat(Schedule.spaced("10 minutes")),
          Effect.ignore,
        ),
      )
    }

    return Service.of({ get, refresh })
  }),
)

export const node = makeGlobalNode({ service: Service, layer: layer, deps: [FSUtil.node, EventV2.node, httpClient] })

export * as ModelsDev from "./models-dev"
