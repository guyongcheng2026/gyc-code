export * as BashTool from "./bash"

import path from "path"
import { ToolFailure } from "@gyccode/llm"
import { Duration, Effect, Layer, Schema } from "effect"
import { ChildProcess } from "effect/unstable/process"
import { Config } from "../config"
import { makeLocationNode } from "../effect/app-node"
import { FSUtil } from "../fs-util"
import { LocationMutation } from "../location-mutation"
import { AppProcess } from "../process"
import { PermissionV2 } from "../permission"
import { PositiveInt } from "../schema"
import { ToolRegistry } from "./registry"
import { Tool } from "./tool"
import { Tools } from "./tools"

export const name = "bash"
export const DEFAULT_TIMEOUT_MS = 2 * 60 * 1_000
export const MAX_TIMEOUT_MS = 10 * 60 * 1_000
export const MAX_CAPTURE_BYTES = 1024 * 1024

export const Input = Schema.Struct({
  command: Schema.String.annotate({ description: "Shell command string to execute" }),
  workdir: Schema.String.pipe(Schema.optional).annotate({
    description: "Working directory. Defaults to the active Location; relative paths resolve from that Location.",
  }),
  timeout: PositiveInt.check(Schema.isLessThanOrEqualTo(MAX_TIMEOUT_MS))
    .pipe(Schema.optional)
    .annotate({
      description: `Timeout in milliseconds. Defaults to ${DEFAULT_TIMEOUT_MS} and may not exceed ${MAX_TIMEOUT_MS}.`,
    }),
})

const StructuredOutput = Schema.Struct({
  exit: Schema.Number.pipe(Schema.optional),
  truncated: Schema.Boolean,
  timeout: Schema.Boolean.pipe(Schema.optional),
})

const Output = Schema.Struct({
  ...StructuredOutput.fields,
  output: Schema.String,
  warnings: Schema.Array(Schema.String).pipe(Schema.optional),
})

type Output = typeof Output.Type

const defaultShell = () => (process.platform === "win32" ? (process.env.COMSPEC ?? "cmd.exe") : "/bin/sh")

const modelOutput = (output: Output) => {
  const warnings = output.warnings?.length
    ? `\n\nWarnings:\n${output.warnings.map((warning) => `- ${warning}`).join("\n")}`
    : ""
  if (output.timeout) return `${warnings.trimStart()}${warnings ? "\n\n" : ""}Command timed out before completion.`
  return `${warnings.trimStart()}${warnings ? "\n\n" : ""}Command exited with code ${output.exit}.`
}

const isTimeout = (error: AppProcess.AppProcessError) =>
  error.cause instanceof Error && error.cause.message === "Timed out"

/**
 * Minimal V2 core shell boundary. Keep parity debt visible without pulling the
 * legacy shell runtime into core.
 */
// TODO: Port tree-sitter bash / PowerShell parser-based approval reduction.
// TODO: Port BashArity reusable command-prefix approvals.
// TODO: Replace token-based command-argument external-directory advisories with parser-based detection.
// TODO: Restore PowerShell and cmd-specific invocation/path handling on Windows.
// TODO: Add plugin shell.env environment augmentation once V2 plugin hooks exist.
// TODO: Add durable/live progress metadata streaming for long-running commands once V2 tool invocation progress context is wired.
// TODO: Persist background job status and define restart recovery before exposing remote observation.
// TODO: Re-add model-facing background launch only with owner-bound get/wait/cancel tools and completion delivery.
// TODO: Add HTTP background-job observation only after durable status, restart recovery, and authorization are defined.
// TODO: Revisit process-group cleanup and platform coverage with shell-specific tests if current AppProcess semantics do not fully cover it.
// TODO: Revisit binary output handling if stdout/stderr decoding is text-only.
// TODO: Stream full shell output into managed storage while retaining only a bounded in-memory preview.

const shellTokens = (command: string) => command.match(/(?:[^\s"']+|"[^"]*"|'[^']*')+/g) ?? []
const unquote = (value: string) => value.replace(/^(['"])(.*)\1$/, "$2")
const externalCommandDirectories = Effect.fn("BashTool.externalCommandDirectories")(function* (
  fs: FSUtil.Interface,
  command: string,
  cwd: string,
) {
  const directories = new Set<string>()
  for (const token of shellTokens(command)) {
    const value = unquote(token).replace(/[;,|&]+$/, "")
    if (!path.isAbsolute(value)) continue
    const resolved = yield* fs.resolve(value)
    if (FSUtil.contains(cwd, resolved)) continue
    directories.add(yield* fs.resolve(path.dirname(resolved)))
  }
  return [...directories]
})

/** External directories not covered by any allowed root; empty when all are permitted. */
export const blockedExternalPaths = (
  externalDirectories: readonly string[],
  allowedRoots: readonly string[],
) => externalDirectories.filter((directory) => !allowedRoots.some((root) => FSUtil.contains(root, directory)))

const layer = Layer.effectDiscard(
  Effect.gen(function* () {
    const tools = yield* Tools.Service
    const mutation = yield* LocationMutation.Service
    const fs = yield* FSUtil.Service
    const appProcess = yield* AppProcess.Service
    const config = yield* Config.Service
    const permission = yield* PermissionV2.Service

    yield* tools
      .register({
        [name]: Tool.make({
          description: `Execute one shell command string with the host user's filesystem, process, and network authority. The active Location is the default working directory. Relative workdir values resolve from that Location. External workdir values require external_directory approval. When "shell_enforcement.block_external_paths" is enabled in gyccode.json, command arguments referencing paths outside approved directories are rejected; otherwise they produce advisory warnings only. Timeout values are milliseconds (default: ${DEFAULT_TIMEOUT_MS}; maximum: ${MAX_TIMEOUT_MS}). Uses the configured shell when set; otherwise uses /bin/sh on POSIX and COMSPEC or cmd.exe on Windows.`,
          input: Input,
          output: Output,
          structured: StructuredOutput,
          toStructuredOutput: ({ output }) => ({
            truncated: output.truncated,
            ...(output.exit === undefined ? {} : { exit: output.exit }),
            ...(output.timeout === undefined ? {} : { timeout: output.timeout }),
          }),
          toModelOutput: ({ output }) => [
            { type: "text", text: output.output },
            { type: "text", text: modelOutput(output) },
          ],
          execute: (input, context): Effect.Effect<typeof Output.Type, ToolFailure, never> =>
            Effect.gen(function* () {
              const source = {
                type: "tool" as const,
                messageID: context.assistantMessageID,
                callID: context.toolCallID,
              }
              const target = yield* mutation.resolve({ path: input.workdir ?? ".", kind: "directory" })
              const external = target.externalDirectory
              if (external)
                yield* permission.assert({
                  ...LocationMutation.externalDirectoryPermission(external),
                  sessionID: context.sessionID,
                  agent: context.agent,
                  source,
                })
              const entries = yield* config.entries()
              const shell =
                Object.assign({}, ...entries.flatMap((entry) => (entry.type === "document" ? [entry.info] : [])))
                  .shell ?? defaultShell()
              const enforcement = Config.latest(entries, "shell_enforcement")
              const externalDirectories = yield* externalCommandDirectories(fs, input.command, target.canonical)
              let invalidAllowPaths: readonly string[] = []
              if (enforcement?.block_external_paths && externalDirectories.length > 0) {
                // allow_paths 单条解析失败不再整体报错（此前会被 mapError 吞成笼统错误）：
                // 跳过无效条目并在 warnings 显式列出，合法条目照常生效
                const allowPathEntries = (yield* Effect.forEach(
                  enforcement.allow_paths ?? [],
                  (value) =>
                    fs.resolve(value).pipe(
                      Effect.map((resolved) => [value, resolved] as const),
                      Effect.catchCause(() => Effect.succeed([value, undefined] as const)),
                    ),
                )) as unknown as readonly [string, string | undefined][]
                const allowedRoots = allowPathEntries
                  .filter<[string, string]>((entry): entry is [string, string] => entry[1] !== undefined)
                  .map((entry) => entry[1])
                invalidAllowPaths = allowPathEntries
                  .filter<[string, undefined]>((entry): entry is [string, undefined] => entry[1] === undefined)
                  .map(([value]) => value)
                const blocked = blockedExternalPaths(externalDirectories, allowedRoots)
                if (blocked.length > 0)
                  return yield* Effect.fail(
                    new ToolFailure({
                      message: `Blocked by "shell_enforcement.block_external_paths": command references paths outside approved directories: ${blocked.map((directory) => path.join(directory, "*").replaceAll("\\", "/")).join(", ")}. Extend "shell_enforcement.allow_paths" in gyccode.json or disable the setting to downgrade to advisory warnings.`,
                    }),
                  )
              }
              const warnings = [
                ...externalDirectories.map(
                  (directory) =>
                    `Command argument references external directory ${path.join(directory, "*").replaceAll("\\", "/")}. Bash runs with host-user filesystem, process, and network authority${enforcement?.block_external_paths ? "" : "; this scan is advisory only"}.`,
                ),
                ...(invalidAllowPaths.length > 0
                  ? [
                      `Ignored unresolvable "shell_enforcement.allow_paths" entries: ${invalidAllowPaths.map((value) => JSON.stringify(value)).join(", ")}.`,
                    ]
                  : []),
              ]
              yield* permission.assert({
                action: name,
                resources: [input.command],
                save: [input.command],
                sessionID: context.sessionID,
                agent: context.agent,
                source,
              })

              if ((yield* fs.stat(target.canonical)).type !== "Directory")
                return yield* Effect.fail(new Error(`Working directory is not a directory: ${target.canonical}`))

              const command = ChildProcess.make(input.command, [], {
                cwd: target.canonical,
                shell,
                stdin: "ignore",
                detached: process.platform !== "win32",
                forceKillAfter: Duration.seconds(3),
              })
              const timeout = input.timeout ?? DEFAULT_TIMEOUT_MS
              const result = yield* appProcess
                .run(command, {
                  combineOutput: true,
                  timeout: Duration.millis(timeout),
                  maxOutputBytes: MAX_CAPTURE_BYTES,
                })
                .pipe(
                  Effect.catchTag("AppProcessError", (error) =>
                    isTimeout(error) ? Effect.succeed(undefined) : Effect.fail(error),
                  ),
                )
              if (!result) {
                return {
                  output: `Command exceeded timeout of ${timeout} ms. Retry with a larger timeout if the command is expected to take longer.`,
                  truncated: false,
                  timeout: true,
                  ...(warnings.length ? { warnings } : {}),
                }
              }

              const output = result.output?.toString("utf8") || "(no output)"
              const notice = result.outputTruncated
                ? "[output capture truncated at the in-memory safety limit]"
                : undefined
              return {
                exit: result.exitCode,
                output: notice ? `${output}\n\n${notice}` : output,
                truncated: result.outputTruncated === true,
                ...(warnings.length ? { warnings } : {}),
              }
            }).pipe(
              Effect.mapError((error) =>
                error instanceof ToolFailure
                  ? error
                  : new ToolFailure({ message: `Unable to execute command: ${input.command}` }),
              ),
            ),
        }),
      })
      .pipe(Effect.orDie)
  }),
)

export const node = makeLocationNode({
  name: "tool/bash",
  layer,
  deps: [ToolRegistry.node, LocationMutation.node, FSUtil.node, AppProcess.node, Config.node, PermissionV2.node],
})
