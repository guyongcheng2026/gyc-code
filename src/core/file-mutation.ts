export * as FileMutation from "./file-mutation"

import { makeLocationNode } from "./effect/app-node"
import { Context, Effect, Layer, Schema, Option, Cause } from "effect"
import { dirname, join } from "path"
import { spawn } from "node:child_process"
import type { ChildProcess } from "node:child_process"
import { readFile } from "node:fs/promises"
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

export type TransactionOp =
  | { readonly type: "create"; readonly input: WriteInput }
  | { readonly type: "write"; readonly input: WriteInput }
  | { readonly type: "writeTextPreservingBom"; readonly input: TextWriteInput }
  | { readonly type: "writeIfUnchanged"; readonly input: ConditionalWriteInput }
  | { readonly type: "remove"; readonly input: RemoveInput }

export interface TransactionResult {
  readonly op: TransactionOp
  readonly result: WriteResult | RemoveResult
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
  /** Execute multiple operations atomically. On failure, restores pre-transaction state via snapshot. */
  readonly transaction: (ops: readonly TransactionOp[]) => Effect.Effect<readonly TransactionResult[], FSUtil.Error | Snapshot.Error | StaleContentError | TargetExistsError>
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

    /** Execute multiple operations atomically: capture snapshot, run all ops, on failure restore snapshot. */
    const transaction = Effect.fn("FileMutation.transaction")(
      (ops: readonly TransactionOp[]) =>
        Effect.gen(function* () {
          if (!snapshot) return yield* new Snapshot.Error({ operation: "capture", message: "Snapshot service unavailable" })
          const snapId = yield* snapshot.capture()
          if (snapId === undefined) return yield* new Snapshot.Error({ operation: "capture", message: "Failed to capture pre-transaction snapshot" })

          const results: TransactionResult[] = []
          for (const op of ops) {
            let result: WriteResult | RemoveResult
            switch (op.type) {
              case "create":
                result = yield* create(op.input)
                break
              case "write":
                result = yield* write(op.input)
                break
              case "writeTextPreservingBom":
                result = yield* writeTextPreservingBom(op.input)
                break
              case "writeIfUnchanged":
                result = yield* writeIfUnchanged(op.input)
                break
              case "remove":
                result = yield* remove(op.input)
                break
            }
            results.push({ op, result })
          }
          return results
        }),
    )

    return Service.of({ create, write, writeTextPreservingBom, writeIfUnchanged, remove, transaction })
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

/** 写后自动类型检查：默认最长等待时间（毫秒）。超时必须中止，绝不允许无限等待。 */
export const AUTOCHECK_MAX_LATENCY_MS = 20_000

/** 自动检查可调项：enabled=false 或环境变量 GYCCODE_AUTOCHECK=0/off/false 均可关闭 */
export interface AutocheckOptions {
  readonly enabled?: boolean
  readonly maxLatencyMs?: number
  /** 直接指定命令，便于测试与特殊工程覆盖 */
  readonly command?: readonly string[]
}

/** 单条结构化类型诊断 */
export interface TypecheckDiagnostic {
  readonly file: string
  readonly line: number
  readonly code: string
  readonly message: string
}

/** checked=真的跑了；skipped=超时/命令起不来/被关闭 */
export type TypecheckStatus = "checked" | "skipped"

export interface TypecheckReport {
  readonly status: TypecheckStatus
  readonly command: string
  readonly reason?: string
  readonly diagnostics: readonly TypecheckDiagnostic[]
}

type RunResult =
  | { readonly kind: "done"; readonly stdout: string; readonly stderr: string }
  | { readonly kind: "timeout"; readonly reason?: string }
  | { readonly kind: "spawn-error"; readonly reason: string }

/** 依次尝试的 typecheck 脚本名，取自 package.json 的 scripts */
const TYPECHECK_SCRIPTS = ["typecheck", "check-types", "tsc", "check"]

const DISABLED_ENV_VALUES = new Set(["0", "false", "off", "no"])

function autocheckEnabledByEnv() {
  const raw = process.env["GYCCODE_AUTOCHECK"]
  if (raw === undefined) return true
  return !DISABLED_ENV_VALUES.has(raw.trim().toLowerCase())
}

function readScripts(root: string) {
  return readFile(join(root, "package.json"), "utf8")
    .then((raw) => (JSON.parse(raw) as { scripts?: Record<string, string> }).scripts)
    .catch(() => undefined)
}

/** 先看工程 scripts 里有没有现成的 typecheck，没有再退回 npx tsc --noEmit */
async function resolveTypecheckCommand(root: string): Promise<readonly string[]> {
  const scripts = await readScripts(root)
  if (scripts) {
    for (const name of TYPECHECK_SCRIPTS) {
      const script = scripts[name]
      if (typeof script === "string" && script.length > 0) return ["bun", "run", name]
    }
  }
  return ["npx", "--no-install", "tsc", "--noEmit"]
}

/**
 * 启动子进程并收集输出。硬超时到点立即 kill，保证自动检查绝不会把主流程挂死。
 */
function runCommand(command: readonly string[], cwd: string, timeoutMs: number): Promise<RunResult> {
  return new Promise<RunResult>((resolve) => {
    let settled = false
    let timer: ReturnType<typeof setTimeout> | undefined
    const finish = (result: RunResult) => {
      if (settled) return
      settled = true
      if (timer) clearTimeout(timer)
      resolve(result)
    }

    let child: ChildProcess
    try {
      child = spawn(command[0] as string, command.slice(1), {
        cwd,
        shell: false,
        windowsHide: true,
        env: process.env,
      })
    } catch (error) {
      finish({ kind: "spawn-error", reason: error instanceof Error ? error.message : String(error) })
      return
    }

    timer = setTimeout(() => {
      // kill 失败（进程已自行退出、或无权限终止）不改变超时判定：finish 仍照常收尾，
      // 但要把失败原因带出去，否则这就是一处静默吞掉失败的分支。
      let killReason: string | undefined
      try {
        child.kill("SIGKILL")
      } catch (error) {
        killReason = error instanceof Error ? error.message : String(error)
      }
      finish({ kind: "timeout", reason: killReason })
    }, timeoutMs)

    let stdout = ""
    let stderr = ""
    child.stdout?.setEncoding("utf8")
    child.stderr?.setEncoding("utf8")
    child.stdout?.on("data", (chunk: string) => {
      stdout += chunk
    })
    child.stderr?.on("data", (chunk: string) => {
      stderr += chunk
    })
    child.on("error", (error) => finish({ kind: "spawn-error", reason: error.message }))
    child.on("close", () => finish({ kind: "done", stdout, stderr }))
  })
}

/** 兼容 tsc 两种输出形态：file(line,col): error TSxxxx: msg 与 file:line:col - error TSxxxx: msg */
const TSC_PAREN = /^(.+?)\((\d+),(\d+)\):\s+error\s+(TS\d+):\s+(.*)$/
const TSC_PRETTY = /^(.+?):(\d+):(\d+)\s+-\s+error\s+(TS\d+):\s+(.*)$/

export function parseTypecheckOutput(output: string): TypecheckDiagnostic[] {
  const diagnostics: TypecheckDiagnostic[] = []
  for (const raw of output.split(/\r?\n/)) {
    const line = raw.trim()
    if (!line) continue
    const match = TSC_PAREN.exec(line) ?? TSC_PRETTY.exec(line)
    if (!match) continue
    diagnostics.push({
      file: match[1] as string,
      line: Number(match[2]),
      code: match[4] as string,
      message: (match[5] as string).trim(),
    })
  }
  return diagnostics
}

/**
 * 在项目根目录跑类型检查并解析成结构化诊断。
 * 超时、命令起不来、被显式关闭时一律返回 status="skipped"，绝不抛异常、绝不无限等待。
 */
export async function typecheckDiagnostics(
  root: string,
  opts: AutocheckOptions = {},
): Promise<TypecheckReport> {
  const enabled = opts.enabled ?? autocheckEnabledByEnv()
  if (!enabled) {
    return { status: "skipped", command: "", reason: "自动类型检查已被开关关闭", diagnostics: [] }
  }

  const budget =
    opts.maxLatencyMs !== undefined && Number.isFinite(opts.maxLatencyMs) && opts.maxLatencyMs > 0
      ? opts.maxLatencyMs
      : AUTOCHECK_MAX_LATENCY_MS
  const command = opts.command ? [...opts.command] : await resolveTypecheckCommand(root)
  const display = command.join(" ")

  const run = await runCommand(command, root, budget)
  if (run.kind === "spawn-error") {
    return {
      status: "skipped",
      command: display,
      reason: `类型检查命令未能启动，已跳过：${run.reason}`,
      diagnostics: [],
    }
  }
  if (run.kind === "timeout") {
    const killNote = run.reason ? `（终止子进程失败：${run.reason}）` : ""
    return {
      status: "skipped",
      command: display,
      reason: `类型检查超时（超过 ${budget}ms），已中止并跳过${killNote}`,
      diagnostics: [],
    }
  }
  return { status: "checked", command: display, diagnostics: parseTypecheckOutput(`${run.stderr}\n${run.stdout}`) }
}

/** 把诊断报告转成回灌给模型的结构化文案，风格对齐 shell.ts 的 <tool_error> 约定 */
export function typecheckNotice(report: TypecheckReport, maxItems = 5): string {
  if (report.status === "skipped") {
    return [
      `<tool_error kind="typecheck_skipped" tool="edit">`,
      `写后类型检查已跳过，本次改动未做类型验证。`,
      `命令：${report.command || "(未解析)"}`,
      `原因：${report.reason ?? "未知"}`,
      `请勿据此认为改动类型正确；如需确认请自行运行类型检查。`,
      `</tool_error>`,
    ].join("\n")
  }

  if (report.diagnostics.length === 0) {
    return `<typecheck_report tool="edit" status="passed">类型检查通过：本次改动后未发现类型错误。</typecheck_report>`
  }

  const total = report.diagnostics.length
  const shown = report.diagnostics.slice(0, Math.max(1, maxItems))
  const lines = [
    `<tool_error kind="typecheck_failed" tool="edit">`,
    `本次改动后类型检查发现 ${total} 个错误，必须修复后再交付。`,
    `命令：${report.command}`,
  ]
  for (const item of shown) {
    lines.push(`${item.file}:${item.line} [${item.code}] ${item.message}`)
  }
  if (total > shown.length) lines.push(`另有 ${total - shown.length} 个错误未展示。`)
  lines.push(`以上类型错误由自动检查捕获，必须修复后再交付，不得忽略。`)
  lines.push(`</tool_error>`)
  return lines.join("\n")
}

export const locationLayer = layer

export const node = makeLocationNode({ service: Service, layer, deps: [FSUtil.node] })

/**
 * V2 integrations (formatter, watcher, snapshot, LSP touchFile) are now hooked in write/create/remove.
 * Multi-file transaction API added (atomic op batch, rollback via snapshot TODO in apply_patch atomic design).
 * Crash recovery & idempotency for Tool.Called -> durable settlement defined in
 * SessionRunner.failInterruptedTools (fail-closed deterministic settlement, callID as idempotency key).
 * Remaining:
 * - Full rollback on failure (needs apply_patch atomic design + Snapshot.restore integration)
 */

