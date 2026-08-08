import { Schema } from "effect"

export const TeammateRole = Schema.Union(
  Schema.Literal("explorer"),
  Schema.Literal("implementer"),
  Schema.Literal("reviewer"),
  Schema.Literal("debugger"),
)
export type TeammateRole = typeof TeammateRole.Type

export class TeammateConfig extends Schema.Class<TeammateConfig>("TeammateConfig")({
  role: TeammateRole,
  model: Schema.optional(Schema.String),
  maxSteps: Schema.optional(Schema.Int.pipe(Schema.greaterThan(0))),
  systemPrompt: Schema.optional(Schema.String),
}) {}

export class TeammateResult extends Schema.Class<TeammateResult>("TeammateResult")({
  role: TeammateRole,
  success: Schema.Boolean,
  summary: Schema.String,
  stepsCompleted: Schema.Number,
  output: Schema.optional(Schema.String),
}) {}

export class SwarmPlan extends Schema.Class<SwarmPlan>("SwarmPlan")({
  goal: Schema.String,
  teammates: Schema.Array(TeammateConfig),
  strategy: Schema.String,
}) {}
