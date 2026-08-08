import { Schema } from "effect"

export const HookEvent = Schema.Union(
  Schema.Literal("PreToolUse"),
  Schema.Literal("PostToolUse"),
  Schema.Literal("PreCompact"),
  Schema.Literal("PostCompact"),
  Schema.Literal("SessionStart"),
  Schema.Literal("SessionEnd"),
  Schema.Literal("PreMessage"),
  Schema.Literal("PostMessage"),
  Schema.Literal("Notification"),
)
export type HookEvent = typeof HookEvent.Type

export class HookConfig extends Schema.Class<HookConfig>("HookConfig")({
  event: HookEvent,
  command: Schema.String,
  matcher: Schema.optional(Schema.String),
  timeout: Schema.optional(Schema.Int.pipe(Schema.greaterThan(0))),
}) {}

export class HookResult extends Schema.Class<HookResult>("HookResult")({
  event: HookEvent,
  stdout: Schema.String,
  stderr: Schema.String,
  exitCode: Schema.Number,
  duration: Schema.Number,
}) {}
