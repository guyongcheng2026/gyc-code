export * as FileMutation from "./file-mutation"

import { makeLocationNode } from "./effect/app-node"
import { Context, Effect, Layer, Schema, Option } from "effect"
import { dirname } from "path"
import { KeyedMutex } from "./effect/keyed-mutex"
import { FSUtil } from "./fs-util"
import { detectTextEncoding, encodeForWrite } from "./util/text-encoding"
import { Format } from "../gyccode/format"
import { LSP } from "../gyccode/lsp/lsp"
import { EventV2 } from "./event"
import { Snapshot } from "./snapshot"
import { FileSystemWatcher } from "@gyccode/schema/filesystem-watcher"

export interface Target {
  readonly canonical: string
  readonly resource: string
}

export interface WriteInput {
  readonly target: Target
  readonly content: string | Uint8Array
}

export interface TextWriteInput {
  readonly target: Target
  readonly content: string
}

export interface ConditionalWriteInput extends WriteInput {
  readonly expected: Uint8Array
}

export interface RemoveInput {
  readonly target: Target
}

export class StaleContentError extends Schema.TaggedErrorClass<StaleContentError>()("FileMutation.StaleContentError", {
  path: Schema.String,
}) {}

export class TargetExistsError extends Schema.TaggedErrorClass<TargetExistsError>()("FileMutation.TargetExistsError", {
  path: Schema.String,
}) {}

export interface WriteResult {
  readonly operation: "write"
  readonly target: string
  readonly resource: string
  readonly existed: boolean
}

export interface RemoveResult {
  readonly operation: "remove"
  readonly target: string
  readonly resource: string
  readonly existed: boolean
}

export interface Interface {
  /** Create without replacing an existing target. */
  readonly create: (input: WriteInput) => Effect.Effect<WriteResult, TargetExistsError | FSUtil.Error>
  readonly write: (input: WriteInput) => Effect.Effect<WriteResult, FSUtil.Error>
  /** Write text while retaining an existing UTF-8 BOM and emitting at most one BOM. */
  readonly writeTextPreservingBom: (input: TextWriteInput) => Effect.Effect<WriteResult, FSUtil.Error>
  /** Commit only if an existing target still has the expected bytes. */
  readonly writeIfUnchanged: (
    input: ConditionalWriteInput,
  ) => Effect.Effect<WriteResult, StaleContentError | FSUtil.Error>
  readonly remove: (input: RemoveInput) => Effect.Effect<RemoveResult, FSUtil.Error>
}

export class Service extends Context.Service<Service, Interface>()("@gyccode/v2/FileMutation") {}

/**
 * Serialize file changes by canonical target. Conditional writes compare and
 * write under the same process-local lock so cooperating GycCode mutations do
 * not overwrite changes made from the same stale content.
 */
const layer = Layer.effect(
  Service,
  Effect.gen(function* () {
    const fs = yield* FSUtil.Service
    const locks = KeyedMutex.makeUnsafe<string>()
    const formatter = Option.getOrUndefined(yield* Effect.serviceOption(Format.Service))
    const events = Option.getOrUndefined(yield* Effect.serviceOption(EventV2.Service))
    const snapshot = Option.getOrUndefined(yield* Effect.serviceOption(Snapshot.Service)) as Snapshot.Interface | undefined
    const lsp = Option.getOrUndefined(yield* Effect.serviceOption(LSP.Service))
    const withTargetLock =
      (target: Target) =>
      <A, E, R>(effect: Effect.Effect<A, E, R>) =>
        locks.withLock(target.canonical)(Effect.uninterruptible(effect))

    const writeResult = (target: Target, existed: boolean): WriteResult => ({
      operation: "write",
      target: target.canonical,
      resource: target.resource,
      existed,
    })

    const removeResult = (target: Target, existed: boolean): RemoveResult => ({
      operation: "remove",
      target: target.canonical,
      resource: target.resource,
      existed,
    })

    /** Post-write integrations: formatter, watcher events, snapshot, LSP */
    const runPostWriteHooks = (target: Target) =>
      Effect.gen(function* () {
        if (formatter) {
          yield* formatter.file(target.canonical).pipe(
            Effect.catchCause(() => Effect.void),
          )
        }
        if (events) {
          yield* events.publish(FileSystemWatcher.Event.Updated, {
            file: target.canonical,
            event: "change",
          }).pipe(Effect.catchCause(() => Effect.void))
        }
        if (snapshot) {
          yield* snapshot.capture().pipe(Effect.catchCause(() => Effect.void))
        }
        if (lsp) {
          yield* lsp.touchFile(target.canonical, "document").pipe(
            Effect.catchCause(() => Effect.void),
          )
        }
      })

    /** Pre-write snapshot for undo */
    const runPreWriteHooks = (target: Target) =>
      Effect.gen(function* () {
        if (snapshot) {
          yield* snapshot.capture().pipe(Effect.catchCause(() => Effect.void))
        }
      })

    const write = Effect.fn("FileMutation.write")((input: WriteInput) =>
      withTargetLock(input.target)(
        Effect.gen(function* () {
          const existed = yield* fs.exists(input.target.canonical)
          yield* runPreWriteHooks(input.target)
          yield* fs.writeWithDirs(input.target.canonical, input.content)
          const result = writeResult(input.target, existed)
          yield* runPostWriteHooks(input.target)
          return result
        }),
      ),
    )

    const writeTextPreservingBom = Effect.fn("FileMutation.writeTextPreservingBom")((input: TextWriteInput) =>
      withTargetLock(input.target)(
        Effect.gen(function* () {
          const next = splitBom(input.content)
          const current = yield* fs
            .readFile(input.target.canonical)
            .pipe(Effect.catchReason("PlatformError", "NotFound", () => Effect.succeed(undefined)))
          const encoding = current === undefined ? "utf-8" : detectTextEncoding(current)
          yield* runPreWriteHooks(input.target)
          yield* fs.writeWithDirs(
            input.target.canonical,
            encodeForWrite(next.text, encoding, Boolean(current && hasUtf8Bom(current)) || next.bom),
          )
          const result = writeResult(input.target, current !== undefined)
          yield* runPostWriteHooks(input.target)
          return result
        }),
      ),
    )

    const create = Effect.fn("FileMutation.create")((input: WriteInput) =>
      withTargetLock(input.target)(
        Effect.gen(function* () {
          const write =
            typeof input.content === "string"
              ? fs.writeFileString(input.target.canonical, input.content, { flag: "wx" })
              : fs.writeFile(input.target.canonical, input.content, { flag: "wx" })
          yield* write.pipe(
            Effect.catchReason("PlatformError", "NotFound", () =>
              fs.ensureDir(dirname(input.target.canonical)).pipe(Effect.andThen(write)),
            ),
            Effect.catchReason("PlatformError", "AlreadyExists", () =>
              Effect.fail(new TargetExistsError({ path: input.target.canonical })),
            ),
          )
          yield* runPreWriteHooks(input.target)
          const result = writeResult(input.target, false)
          yield* runPostWriteHooks(input.target)
          return result
        }),
      ),
    )

    const writeIfUnchanged = Effect.fn("FileMutation.writeIfUnchanged")((input: ConditionalWriteInput) =>
      withTargetLock(input.target)(
        Effect.gen(function* () {
          const current = yield* fs.readFile(input.target.canonical)
          if (!sameBytes(current, input.expected)) {
            return yield* new StaleContentError({ path: input.target.canonical })
          }
          yield* runPreWriteHooks(input.target)
          yield* typeof input.content === "string"
            ? fs.writeFileString(input.target.canonical, input.content)
            : fs.writeFile(input.target.canonical, input.content)
          const result = writeResult(input.target, true)
          yield* runPostWriteHooks(input.target)
          return result
        }),
      ),
    )

    const remove = Effect.fn("FileMutation.remove")((input: RemoveInput) =>
      withTargetLock(input.target)(
        Effect.gen(function* () {
          yield* runPreWriteHooks(input.target)
          const existed = yield* fs.remove(input.target.canonical).pipe(
            Effect.as(true),
            Effect.catchReason("PlatformError", "NotFound", () => Effect.succeed(false)),
          )
          const result = removeResult(input.target, existed)
          yield* runPostWriteHooks(input.target)
          return result
        }),
      ),
    )

    return Service.of({ create, write, writeTextPreservingBom, writeIfUnchanged, remove })
  }),
)

function splitBom(text: string) {
  const stripped = text.replace(/^\uFEFF+/, "")
  return { bom: stripped.length !== text.length, text: stripped }
}


function hasUtf8Bom(content: Uint8Array) {
  return content[0] === 0xef && content[1] === 0xbb && content[2] === 0xbf
}

function sameBytes(left: Uint8Array, right: Uint8Array) {
  if (left.length !== right.length) return false
  return left.every((byte, index) => byte === right[index])
}

export const locationLayer = layer

export const node = makeLocationNode({ service: Service, layer, deps: [FSUtil.node] })

/**
 * V2 integrations (formatter, watcher, snapshot, LSP touchFile) are now hooked in write/create/remove.
 * Remaining:
 * - Multi-file transactions / rollback (needs apply_patch atomic design)
 * - Crash recovery & idempotency for Tool.Called -> durable settlement
 */

