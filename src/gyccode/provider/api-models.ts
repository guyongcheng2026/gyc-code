import { Effect, Layer, Context, Schedule, Duration, Option } from "effect"
import { FSUtil } from "@gyccode/core/fs-util"
import { Flag } from "@gyccode/core/flag/flag"
import { Global } from "@gyccode/core/global"
import { Hash } from "@gyccode/core/util/hash"
import { Flock } from "@gyccode/core/util/flock"
import { InstallationChannel, InstallationVersion } from "@gyccode/core/installation/version"
import { makeGlobalNode } from "@gyccode/core/effect/app-node"
import { ModelV2 } from "@gyccode/core/model"
import { ProviderV2 } from "@gyccode/core/provider"
import path from "path"
import type { Model } from "./provider"

const USER_AGENT = `gyccode/${InstallationChannel}/${InstallationVersion}/${Flag.GYCCODE_CLIENT}`
/** models.dev / this codebase express cost per 1M tokens; OpenAI-compatible /models returns per-token. */
const PER_MILLION = 1_000_000
const CACHE_TTL = Duration.minutes(10)
const FETCH_TIMEOUT = "10 seconds"

export interface Target {
  readonly providerID: string
  readonly baseURL: string
  readonly npm?: string
  readonly url?: string
  readonly apiKey?: string
}

export interface ApiModel {
  id: string
  name?: string
  context_length?: number
  pricing?: { prompt?: number; completion?: number }
  architecture?: { input_modalities?: string[]; output_modalities?: string[] }
  supported_parameters?: string[]
  top_provider?: { context_length?: number; max_completion_tokens?: number }
}

function finite(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined
}

function record(value: unknown): Record<string, unknown> | undefined {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined
}

function stringArray(value: unknown): string[] | undefined {
  if (!Array.isArray(value)) return undefined
  return value.filter((item): item is string => typeof item === "string")
}

/**
 * Tolerates every shape seen in the wild: OpenAI-compatible `{ data: [...] }`,
 * a bare array, and providers that add their own envelope fields. Entries
 * without a string id are dropped rather than guessed at.
 */
export function parseApiModels(payload: unknown): ApiModel[] {
  const list = Array.isArray(payload) ? payload : stringArray(record(payload)?.data) ? (record(payload)?.data as unknown[]) : undefined
  if (!Array.isArray(list)) return []
  const result: ApiModel[] = []
  for (const entry of list) {
    const item = record(entry)
    const id = typeof item?.id === "string" ? item.id.trim() : ""
    if (!id) continue
    const model: ApiModel = { id }
    if (typeof item?.name === "string") model.name = item.name
    const context = finite(item?.context_length)
    if (context !== undefined) model.context_length = context
    const pricing = record(item?.pricing)
    if (pricing) {
      const prompt = finite(pricing.prompt)
      const completion = finite(pricing.completion)
      if (prompt !== undefined || completion !== undefined) model.pricing = { prompt, completion }
    }
    const architecture = record(item?.architecture)
    if (architecture) {
      const input = stringArray(architecture.input_modalities)
      const output = stringArray(architecture.output_modalities)
      if (input || output) model.architecture = { input_modalities: input, output_modalities: output }
    }
    const supported = stringArray(item?.supported_parameters)
    if (supported) model.supported_parameters = supported
    const top = record(item?.top_provider)
    if (top) {
      const topContext = finite(top.context_length)
      const maxOutput = finite(top.max_completion_tokens)
      if (topContext !== undefined || maxOutput !== undefined)
        model.top_provider = { context_length: topContext, max_completion_tokens: maxOutput }
    }
    result.push(model)
  }
  return result
}

function modalities(values: string[] | undefined) {
  // No `architecture` block means "unknown", not "text-in capable only" — text
  // stays on so the model is still offered in chat, mirroring provider.ts.
  const has = (item: string) => values?.includes(item) ?? false
  return {
    text: values === undefined ? true : has("text"),
    audio: has("audio"),
    image: has("image"),
    video: has("video"),
    pdf: has("pdf"),
  }
}

export function mapApiModel(model: ApiModel, target: Target): Model {
  const pricing = model.pricing ?? {}
  const hasPrice = pricing.prompt !== undefined || pricing.completion !== undefined
  const supported = model.supported_parameters ?? []
  return {
    id: ModelV2.ID.make(model.id),
    providerID: ProviderV2.ID.make(target.providerID),
    api: {
      id: model.id,
      url: target.url ?? target.baseURL,
      npm: target.npm ?? "@ai-sdk/openai-compatible",
    },
    name: model.name ?? model.id,
    family: "",
    capabilities: {
      // Gateways that omit `supported_parameters` (opencode zen answers with a
      // bare {id, object, created, owned_by}) must not be read as "no tools" —
      // provider.ts already defaults custom endpoints to toolcall/text on.
      temperature: supported.length === 0 ? true : supported.includes("temperature"),
      reasoning: supported.some((item) => item.startsWith("reasoning")),
      attachment: (model.architecture?.input_modalities ?? []).some((item) => item !== "text"),
      toolcall: supported.length === 0 ? true : supported.some((item) => item.startsWith("tool")),
      input: modalities(model.architecture?.input_modalities),
      output: modalities(model.architecture?.output_modalities),
      interleaved: false,
    },
    cost: {
      input: (pricing.prompt ?? 0) * PER_MILLION,
      output: (pricing.completion ?? 0) * PER_MILLION,
      cache: { read: 0, write: 0 },
    },
    // /models without a pricing block means "unknown price", not "free".
    priced: hasPrice,
    limit: {
      context: model.top_provider?.context_length ?? model.context_length ?? 0,
      output: model.top_provider?.max_completion_tokens ?? 0,
    },
    status: "active",
    options: {},
    headers: {},
    release_date: "",
    variants: {},
  }
}

/** API listings only ever fill gaps: catalog and configured metadata win. */
export function mergeApiModels(
  existing: Record<string, Model>,
  models: ApiModel[],
  target: Target,
): Record<string, Model> {
  const merged = { ...existing }
  for (const model of models) {
    if (merged[model.id]) continue
    merged[model.id] = mapApiModel(model, target)
  }
  return merged
}

export class Service extends Context.Service<Service, Interface>()("@gyccode/ApiModels") {}

type Interface = {
  readonly read: (target: Target) => Effect.Effect<ApiModel[]>
  readonly track: (targets: Target[]) => Effect.Effect<void>
  readonly refresh: (force?: boolean) => Effect.Effect<void>
}

const CACHE_DIR = () => path.join(Global.Path.cache, "api-models")

function cacheFile(target: Target) {
  return path.join(CACHE_DIR(), `${Hash.fast(`${target.providerID}:${target.baseURL}`)}.json`)
}

function modelsURL(baseURL: string) {
  return `${baseURL.replace(/\/+$/, "")}/models`
}

const fetchModels = Effect.fnUntraced(function* (target: Target) {
  const response = yield* Effect.tryPromise({
    try: () =>
      fetch(modelsURL(target.baseURL), {
        headers: {
          "User-Agent": USER_AGENT,
          ...(target.apiKey ? { Authorization: `Bearer ${target.apiKey}` } : {}),
        },
      }),
    catch: (cause) => new Error(`api-models fetch failed: ${String(cause)}`),
  })
  if (!response.ok) return yield* Effect.fail(new Error(`api-models ${target.providerID} HTTP ${response.status}`))
  const payload = yield* Effect.tryPromise({
    try: () => response.json() as Promise<unknown>,
    catch: (cause) => new Error(`api-models ${target.providerID} invalid JSON: ${String(cause)}`),
  })
  return parseApiModels(payload)
})

const layer = Layer.effect(
  Service,
  Effect.gen(function* () {
    const fs = yield* FSUtil.Service
    // Tracked targets are resolved by Provider.list(); the background loop owns
    // its own TTL so listing stays offline-safe and never blocks on the network.
    let tracked: Target[] = []
    const memory = new Map<string, ApiModel[]>()

    const load = (target: Target) =>
      fs
        .readJson(cacheFile(target))
        .pipe(
          Effect.catch(() => Effect.succeed(undefined)),
          Effect.map((value) => parseApiModels(value)),
          Effect.map((models) => {
            memory.set(cacheFile(target), models)
            return models
          }),
        )

    const read = Effect.fnUntraced(function* (target: Target) {
      const file = cacheFile(target)
      const cached = memory.get(file)
      if (cached) return cached
      return yield* load(target)
    })

    const fresh = (file: string) =>
      fs
        .stat(file)
        .pipe(
          Effect.catch(() => Effect.succeed(undefined)),
          Effect.map((stat) => {
            const mtime = stat ? Option.getOrElse(stat.mtime, () => new Date(0)).getTime() : 0
            return Date.now() - mtime < Duration.toMillis(CACHE_TTL)
          }),
        )

    const sync = Effect.fnUntraced(function* (target: Target, force: boolean) {
      const file = cacheFile(target)
      if (!force && (yield* fresh(file))) return
      const models = yield* fetchModels(target).pipe(Effect.timeout(FETCH_TIMEOUT))
      // An empty listing is never persisted: it would erase a good cache when a
      // gateway answers 200 with a filtered body.
      if (models.length === 0) return
      // Flock is cross-process: concurrent gyccode CLIs refresh the same file and
      // would otherwise interleave writes into truncated JSON.
      yield* Effect.scoped(Flock.effect(`api-models:${file}`)).pipe(
        Effect.andThen(fs.writeWithDirs(file, JSON.stringify(models))),
        Effect.catch((cause) => Effect.logWarning("api-models cache write failed", { file, cause: String(cause) })),
      )
      memory.set(file, models)
      yield* Effect.logDebug("api-models synced", { provider: target.providerID, models: models.length })
    })

    const track = (targets: Target[]) =>
      Effect.sync(() => {
        tracked = targets
      })

    const refresh = Effect.fnUntraced(function* (force: boolean = false) {
      yield* Effect.forEach(
        tracked,
        (target) => sync(target, force).pipe(Effect.catch((cause) => Effect.logWarning(String(cause)))),
        { concurrency: "unbounded", discard: true },
      )
    })

    if (!Flag.GYCCODE_DISABLE_MODELS_FETCH) {
      // Silent first pass, then every 10 minutes — the provider list itself stays
      // read-only so a cold start never pays for the network round-trip.
      yield* Effect.forkScoped(
        Effect.andThen(Effect.sleep("1 minute"), refresh()).pipe(
          Effect.repeat(Schedule.spaced("10 minutes")),
          Effect.ignore,
        ),
      )
    }

    return Service.of({ read, track, refresh })
  }),
)

export const node = makeGlobalNode({ service: Service, layer: layer, deps: [FSUtil.node] })