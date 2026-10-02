// P2-4 附件外部存储 + 引用
//
// 现状问题：LLM.ToolFileContent.uri（schema/llm.ts:20）直接存 base64 data URL，
// 也就是说每张图、每份 PDF 的字节都随会话消息一起进库、进 prompt。
// 后果有两处：一是会话库体积按附件原样膨胀，二是 to-llm-message.ts 组装
// MediaPart 时被迫把已经内联的 base64 原样再传给 provider。
//
// 本模块的职责只有一个：把字节内容寻址地落盘，让消息里只留一个短引用 ref。
// 关键约束是**幂等**——同内容重复落盘必须收敛到同一路径，否则会话重放、
// 断线重连会不断增殖副本。
export * as AttachmentStore from "./attachment-store"

import path from "path"
import { createHash } from "crypto"
import { Context, Effect, Layer, Schema } from "effect"
import { FSUtil } from "./fs-util"
import { Global } from "./global"
import { makeGlobalNode } from "./effect/app-node"

export const MANAGED_DIRECTORY = "attachment"

/** 落盘后的引用形态：uri 与 ref 同值，ref 只是显式标记出「这里是个本地引用」 */
export interface Reference {
  readonly uri: string
  readonly mime: string
  readonly name?: string
  readonly ref?: string
}

export interface Input {
  readonly uri: string
  readonly mime: string
  readonly name?: string
  readonly ref?: string
}

export class StorageError extends Schema.TaggedErrorClass<StorageError>()("AttachmentStore.StorageError", {
  operation: Schema.Literals(["persist", "load"]),
  cause: Schema.Defect(),
}) {
  override get message() {
    const detail = this.cause instanceof Error ? this.cause.message : String(this.cause)
    return `Failed to ${this.operation} attachment${detail ? `: ${detail}` : ""}`
  }
}

export type Error = StorageError

export interface Interface {
  readonly directory: Effect.Effect<string>
  readonly persist: (bytes: Uint8Array, mime: string) => Effect.Effect<string, StorageError>
  readonly load: (ref: string) => Effect.Effect<Uint8Array, StorageError>
  readonly externalize: (input: Input) => Effect.Effect<Reference, StorageError>
}

export class Service extends Context.Service<Service, Interface>()("@gyccode/v2/AttachmentStore") {}

const EXTENSIONS: Record<string, string> = {
  "image/png": ".png",
  "image/jpeg": ".jpg",
  "image/jpg": ".jpg",
  "image/gif": ".gif",
  "image/webp": ".webp",
  "image/svg+xml": ".svg",
  "image/bmp": ".bmp",
  "application/pdf": ".pdf",
  "audio/mpeg": ".mp3",
  "audio/wav": ".wav",
}

/** mime → 扩展名。只认白名单，未知一律 .bin，避免把 mime 参数拼进路径。 */
export function extensionOf(mime: string): string {
  const key = mime.split(";")[0]?.trim().toLowerCase() ?? ""
  return EXTENSIONS[key] ?? ".bin"
}

/**
 * 解析 base64 data URL。返回 undefined 表示「这不是内联字节，原样透传」。
 * 这里刻意不做任何猜测：只有同时满足 data: 前缀与 ;base64, 载荷才算数，
 * 否则 http(s)/file/相对路径都会在后续步骤被误当成字节去落盘。
 */
export function parseDataUrl(uri: string): { mime: string; bytes: Uint8Array } | undefined {
  if (!uri.startsWith("data:")) return undefined
  const comma = uri.indexOf(",")
  if (comma < 0) return undefined
  const header = uri.slice(5, comma)
  const payload = uri.slice(comma + 1)
  if (!/;base64$/i.test(header)) return undefined
  if (payload.length === 0) return undefined
  if (!/^[A-Za-z0-9+/]*={0,2}$/.test(payload)) return undefined
  const mime = header.slice(0, -";base64".length).trim()
  if (mime.length === 0) return undefined
  return { mime, bytes: new Uint8Array(Buffer.from(payload, "base64")) }
}

/** 内容寻址文件名：同一份内容 + 同一 mime 永远收敛到同一路径 */
export function blobName(bytes: Uint8Array, mime: string): string {
  const digest = createHash("sha256").update(bytes).digest("hex").slice(0, 32)
  return `${digest}${extensionOf(mime)}`
}

/** store 真正用到的文件操作。刻意收窄，测试可用真实 fs 的薄适配器注入，不必拉起完整 FSUtil 图 */
export interface Port {
  readonly exists: (path: string) => Effect.Effect<boolean, unknown>
  readonly makeDirectory: (path: string, options: { recursive: boolean }) => Effect.Effect<void, unknown>
  readonly writeFile: (path: string, bytes: Uint8Array) => Effect.Effect<void, unknown>
  readonly readFile: (path: string) => Effect.Effect<Uint8Array, unknown>
}

const isExists = (cause: unknown) => (cause as NodeJS.ErrnoException | undefined)?.code === "EEXIST"

/**
 * 构造一份绑定到指定数据根目录的实现。
 * 抽出来是为了测试能指向临时目录，不必写进用户真实的 data 目录。
 */
export function of(fs: Port, root: string): Interface {
  const directory = path.join(root, MANAGED_DIRECTORY)
  const persist = (bytes: Uint8Array, mime: string) =>
    Effect.gen(function* () {
      const file = path.join(directory, blobName(bytes, mime))
      if (yield* fs.exists(file).pipe(Effect.orElseSucceed(() => false))) return file
      yield* fs.makeDirectory(directory, { recursive: true }).pipe(
        Effect.mapError((cause) => new StorageError({ operation: "persist", cause })),
      )
      // 并发下另一个 fiber 可能刚写好同名文件，那不是错误，静默收敛即可
      yield* fs.writeFile(file, bytes).pipe(
        Effect.catchIf(isExists, () => Effect.void),
        Effect.mapError((cause) => new StorageError({ operation: "persist", cause })),
      )
      return file
    })
  const service: Interface = {
    directory: Effect.succeed(directory),
    persist,
    load: (ref) =>
      fs.readFile(ref).pipe(
        Effect.map((bytes) => new Uint8Array(bytes)),
        Effect.mapError((cause) => new StorageError({ operation: "load", cause })),
      ),
    externalize: (input) =>
      Effect.gen(function* () {
        // 已经带 ref：这条消息落过盘，直接透传，避免会话重放时重复处理
        if (input.ref !== undefined) return input
        const parsed = parseDataUrl(input.uri)
        if (parsed === undefined) return { uri: input.uri, mime: input.mime, name: input.name }
        const ref = yield* persist(parsed.bytes, input.mime)
        return { uri: ref, mime: input.mime, name: input.name, ref }
      }),
  }
  return Service.of(service)
}

export const layerWith = (root: string) =>
  Layer.effect(
    Service,
    Effect.gen(function* () {
      const fs = yield* FSUtil.Service
      return yield* Effect.succeed(of(fs, root))
    }),
  )

const layer = Layer.effect(
  Service,
  Effect.gen(function* () {
    const fs = yield* FSUtil.Service
    const global = yield* Global.Service
    return yield* Effect.succeed(of(fs, global.data))
  }),
)

export const node = makeGlobalNode({ service: Service, layer, deps: [FSUtil.node, Global.node] })