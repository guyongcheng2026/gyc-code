import { Schema } from "@gyccode/schema"

export const HookEvent = Schema.Literal(
  "PreToolUse",
  "PostToolUse",
  "PreCompact",
  "PostCompact",
  "SessionStart",
  "SessionEnd",
  "PreMessage",
  "PostMessage",
  "Notification",
)
export type HookEvent = typeof HookEvent.Type

export class HookConfig extends Schema.Class<HookConfig>("HookConfig")({
  event: HookEvent,
  command: Schema.String,
  matcher: Schema.optional(Schema.String),
  timeout: Schema.optional(Schema.Number.pipe(Schema.positive(), Schema.int())),
}) {}

export class HookResult extends Schema.Class<HookResult>("HookResult")({
  event: HookEvent,
  stdout: Schema.String,
  stderr: Schema.String,
  exitCode: Schema.Number,
  duration: Schema.Number,
}) {}
