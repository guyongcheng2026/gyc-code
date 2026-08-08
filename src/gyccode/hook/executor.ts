import { Effect } from "effect"
import { ChildProcess } from "effect/unstable/process"
import { HookConfig, HookEvent, HookResult } from "./types"
import { HookRegistry } from "./registry"

export function executeHooks(
  registry: HookRegistry,
  event: HookEvent,
  toolName?: string,
): Effect.Effect<readonly HookResult[], never> {
  const hooks = registry.getHooks(event, toolName)
  if (hooks.length === 0) return Effect.succeed([])

  return Effect.forEach(hooks, (config: HookConfig) =>
    Effect.gen(function* () {
      const start = Date.now()
      const process = yield* ChildProcess.execute(config.command, {
        timeout: config.timeout ?? 30_000,
      })
      const duration = Date.now() - start
      return new HookResult({
        event,
        stdout: process.stdout,
        stderr: process.stderr,
        exitCode: process.exitCode ?? 0,
        duration,
      })
    }),
  )
}
