import { Effect, Scope } from "effect"
import { ChildProcess } from "effect/unstable/process"
import { ChildProcessSpawner } from "effect/unstable/process/ChildProcessSpawner"
import * as Stream from "effect/Stream"
import { HookConfig, HookEvent, HookResult } from "./types"
import { HookRegistry } from "./registry"

export function executeHooks(
  registry: HookRegistry,
  event: HookEvent,
  toolName?: string,
): Effect.Effect<readonly HookResult[], never, ChildProcessSpawner | Scope.Scope> {
  const hooks = registry.getHooks(event, toolName)
  if (hooks.length === 0) return Effect.succeed([])

  return Effect.forEach(hooks, (config: HookConfig) =>
    Effect.gen(function* () {
      const spawner = yield* ChildProcessSpawner
      const start = Date.now()
      const cmd = ChildProcess.make(config.command, [], { shell: true })
      const handle = yield* spawner.spawn(cmd)
      let stdout = ""
      let stderr = ""
      yield* Stream.runForEach(Stream.decodeText(handle.stdout), (chunk) =>
        Effect.sync(() => {
          stdout += chunk
        }),
      )
      yield* Stream.runForEach(Stream.decodeText(handle.stderr), (chunk) =>
        Effect.sync(() => {
          stderr += chunk
        }),
      )
      const exitCode = yield* handle.exitCode
      const duration = Date.now() - start
      return new HookResult({
        event,
        stdout,
        stderr,
        exitCode: exitCode ?? 0,
        duration,
      })
    }).pipe(
      Effect.catch(() =>
        Effect.succeed(
          new HookResult({
            event,
            stdout: "",
            stderr: "Hook execution failed",
            exitCode: 1,
            duration: 0,
          }),
        ),
      ),
    ),
  )
}
