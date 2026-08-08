import { Schema } from "effect"

export const HookEvent = Schema.Literals([
  "PreToolUse",
  "PostToolUse",
  "PreCompact",
  "PostCompact",
  "SessionStart",
  "SessionEnd",
  "PreMessage",
  "PostMessage",
  "Notification",
])
export type HookEvent = typeof HookEvent.Type

export class HookConfig extends Schema.Class<HookConfig>("HookConfig")({
  event: HookEvent,
  command: Schema.String,
  matcher: Schema.optional(Schema.String),
  timeout: Schema.optional(Schema.Int.pipe(Schema.check(Schema.isGreaterThan(0)))),
}) {}

export class HookResult extends Schema.Class<HookResult>("HookResult")({
  event: HookEvent,
  stdout: Schema.String,
  stderr: Schema.String,
  exitCode: Schema.Number,
  duration: Schema.Number,
}) {}
