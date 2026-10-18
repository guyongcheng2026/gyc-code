import { Effect, Fiber, Stream } from "effect"
import { ChildProcess } from "effect/unstable/process"
import type { ChildProcessSpawner } from "effect/unstable/process/ChildProcessSpawner"
import { decodeSubprocessStream } from "@gyccode/core/util/text-encoding"
import * as ShellCommand from "../tool/shell/command"
import type { HookConfig, HookInput, HookOutcome, HookOutput } from "./types"

/** hook 命令的默认超时（毫秒）。与 Claude Code 的 60s 一致。 */
export const DEFAULT_HOOK_TIMEOUT_MS = 60_000

/**
 * 把 hook 子进程的 stdout 解析为结构化输出。stdout 必须是单个 JSON 对象，
 * 否则视为「无结构化决策」（hook 只打印日志/说明，不阻断、不注入）。
 */
export function parseHookOutput(stdout: string): HookOutput | undefined {
  const text = stdout.trim()
  if (!text) return undefined
  try {
    const parsed: unknown = JSON.parse(text)
    if (parsed !== null && typeof parsed === "object" && !Array.isArray(parsed)) {
      return parsed as HookOutput
    }
    return undefined
  } catch {
    return undefined
  }
}

/**
 * 执行单个 hook：spawn `hook.command`（走当前 shell 的解析规则），把
 * `input` 序列化为 JSON 经 stdin 传入，读取 stdout/stderr，超时则强杀。
 *
 * `spawner` 由调用方闭包捕获传入，使本函数不把 ChildProcessSpawner 泄漏到
 * 调用方的 R 通道；单个 hook 的任何失败（spawn / 超时 / 解码）都不会向上抛
 * defect，而是折叠进 `HookOutcome.error`——hook 是可观测旁路，不能打断主流程。
 */
export const runHook = (
  spawner: ChildProcessSpawner["Service"],
  hook: HookConfig,
  input: HookInput,
  shell: string,
) =>
  Effect.gen(function* () {
    const started = Date.now()
    const timeoutMs = hook.timeout ?? DEFAULT_HOOK_TIMEOUT_MS

    const spec = ShellCommand.resolve(shell, hook.command, input.cwd, process.env, false)
    const stdinStream = Stream.succeed(new TextEncoder().encode(JSON.stringify(input)))
    const command = spec.useShell
      ? ChildProcess.make(spec.file, spec.args, {
          shell,
          cwd: spec.options.cwd,
          env: spec.options.env,
          stdin: stdinStream,
        })
      : ChildProcess.make(spec.file, spec.args, {
          cwd: spec.options.cwd,
          env: spec.options.env,
          stdin: stdinStream,
        })

    const result = yield* Effect.scoped(
      Effect.gen(function* () {
        const handle = yield* spawner.spawn(command)
        const stdoutFiber = yield* Effect.forkScoped(Stream.runCollect(decodeSubprocessStream(handle.stdout)))
        const stderrFiber = yield* Effect.forkScoped(Stream.runCollect(decodeSubprocessStream(handle.stderr)))

        const exit = yield* Effect.raceAll([
          handle.exitCode.pipe(Effect.map((code) => ({ kind: "exit" as const, code: Number(code) }))),
          Effect.sleep(`${timeoutMs} millis`).pipe(Effect.map(() => ({ kind: "timeout" as const, code: null }))),
        ])

        if (exit.kind === "timeout") {
          // 超时后进程可能已自行退出，kill 失败只记警告不升级。
          yield* handle.kill({ forceKillAfter: "2 seconds" }).pipe(
            Effect.catchCause(() => Effect.logWarning("failed to kill hook process after timeout", { hook: hook.event })),
          )
        }

        // 进程已退出或被强杀，stdout/stderr 流会随之 end，join 不会悬挂。
        const stdout = Array.from(yield* Fiber.join(stdoutFiber)).join("")
        const stderr = Array.from(yield* Fiber.join(stderrFiber)).join("")
        return { kind: exit.kind, code: exit.code, stdout, stderr }
      }),
    ).pipe(
      Effect.catch((error) =>
        Effect.succeed({
          kind: "error" as const,
          code: null,
          stdout: "",
          stderr: "",
          error: error instanceof Error ? error.message : String(error),
        }),
      ),
    )

    const outcome: HookOutcome = {
      hook,
      exitCode: result.kind === "exit" ? result.code : null,
      stdout: result.stdout,
      stderr: result.stderr,
      duration: Date.now() - started,
      output: parseHookOutput(result.stdout),
      error:
        result.kind === "timeout"
          ? `hook timed out after ${timeoutMs}ms`
          : result.kind === "error"
            ? result.error
            : undefined,
    }
    return outcome
  })
