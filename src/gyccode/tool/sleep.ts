import { Duration, Effect, Schema } from "effect"
import * as Tool from "./tool"
import DESCRIPTION from "./sleep.txt"

export const Parameters = Schema.Struct({
  duration_ms: Schema.Number.annotate({
    description: "The duration to wait in milliseconds (max 300000)",
  }),
})

export const SleepTool = Tool.define(
  "sleep",
  Effect.gen(function* () {
    return {
      description: DESCRIPTION,
      parameters: Parameters,
      execute: (params: Schema.Schema.Type<typeof Parameters>, _ctx: Tool.Context) =>
        Effect.gen(function* () {
          const ms = Math.max(0, Math.min(Math.round(params.duration_ms), 300_000))
          yield* Effect.sleep(Duration.millis(ms)).pipe(Effect.interruptible)
          return {
            title: `Slept for ${ms}ms`,
            output: `Slept for ${ms} milliseconds.`,
            metadata: { duration_ms: ms },
          }
        }).pipe(Effect.orDie),
    } satisfies Tool.DefWithoutID<typeof Parameters>
  }),
)
