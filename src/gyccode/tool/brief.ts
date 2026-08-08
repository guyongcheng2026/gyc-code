import { Effect, Schema } from "effect"
import * as Tool from "./tool"

export const BriefLevel = Schema.Literals(["info", "warning", "critical"])

export class BriefInput extends Schema.Class<BriefInput>("BriefInput")({
  message: Schema.String,
  level: Schema.optional(BriefLevel, { default: () => "info" as const }),
  details: Schema.optional(Schema.String),
}) {}

export const BriefTool = Tool.define<typeof BriefInput, {}>(
  "brief",
  Effect.succeed({
    description:
      "Send a brief notification to the user. Use for progress updates, task completion, or when you need help.",
    parameters: BriefInput,
    execute: (input: BriefInput) => {
      const prefix = input.level === "critical" ? "!!!" : input.level === "warning" ? "\u26A0" : "i"
      const message = `[${prefix}] ${input.message}`
      if (input.details) {
        console.log(`${message}\n  ${input.details}`)
      } else {
        console.log(message)
      }
      return Effect.succeed({
        title: "Brief",
        output: message,
        metadata: { acknowledged: true, level: input.level ?? "info" },
      })
    },
  }),
)
