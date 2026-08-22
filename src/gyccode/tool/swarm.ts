import * as Tool from "./tool"
import { ToolJsonSchema } from "./json-schema"
import { Session } from "@/session/session"
import { MessageID } from "../session/schema"
import { MessageV2 } from "../session/message-v2"
import { Agent } from "../agent/agent"
import { deriveSubagentSessionPermission } from "../agent/subagent-permissions"
import type { SessionPrompt } from "../session/prompt"
import { Config } from "@/config/config"
import { Cause, Effect, Schema } from "effect"
import { Database } from "@gyccode/core/database/database"
import { Provider } from "@/provider/provider"
import { ModelV2 } from "@gyccode/core/model"
import { ProviderV2 } from "@gyccode/core/provider"
import { TeammateRole, TeammateConfig, TeammateResult } from "../agent/swarm/types"
import { createTeammatePrompt, summarizeTeammateResults } from "../agent/swarm/teammate"
import { planSwarm, assignTasks } from "../agent/swarm/coordinator"
import type { TaskPromptOps } from "./task"

const id = "swarm"

const DESCRIPTION = [
  "Launch a coordinated team of in-process sub-agents (teammates) to work on a single goal.",
  "Each teammate runs as its own subagent session in parallel and reports back a structured result.",
  "When you do not specify teammates, the tool derives a team from the goal automatically:",
  "- debugging/fixing goals -> debugger + explorer",
  "- exploration/understanding goals -> explorer",
  "- otherwise -> implementer + reviewer",
  "When you do specify teammates, provide one entry per role you want to spawn.",
  "Use this when a goal benefits from multiple specialized perspectives or parallel work streams.",
].join("\n")

const TeammateInput = Schema.Struct({
  role: TeammateRole.annotate({ description: "The role of the teammate" }),
  task: Schema.optional(Schema.String).annotate({
    description: "The specific task this teammate should perform. Defaults to a role-appropriate task derived from the goal",
  }),
  model: Schema.optional(Schema.String).annotate({
    description: "Model override for this teammate, e.g. \"openai/gpt-4o\" or a bare model ID",
  }),
})

export const Parameters = Schema.Struct({
  goal: Schema.String.annotate({ description: "The single goal the whole swarm should accomplish" }),
  teammates: Schema.optional(Schema.Array(TeammateInput)).annotate({
    description:
      "Optional explicit teammate list. When omitted, teammates are derived automatically from the goal",
  }),
})

// Map swarm roles onto the built-in subagent types.
const ROLE_AGENT: Record<TeammateRole, string> = {
  explorer: "explore",
  implementer: "general",
  reviewer: "general",
  debugger: "general",
}

function deriveRolesForGoal(goal: string): TeammateRole[] {
  const lower = goal.toLowerCase()
  if (lower.includes("debug") || lower.includes("fix")) return ["debugger", "explorer"]
  if (lower.includes("explore") || lower.includes("understand")) return ["explorer"]
  return ["implementer", "reviewer"]
}

function resolveTeammateModel(
  spec: string | undefined,
  fallback: { modelID: ModelV2.ID; providerID: ProviderV2.ID },
) {
  if (!spec) return fallback
  if (spec.includes("/")) return Provider.parseModel(spec)
  return { modelID: ModelV2.ID.make(spec), providerID: fallback.providerID }
}

export const SwarmTool = Tool.define(
  id,
  Effect.gen(function* () {
    const agent = yield* Agent.Service
    const config = yield* Config.Service
    const sessions = yield* Session.Service
    const database = yield* Database.Service

    const run = Effect.fn("SwarmTool.execute")(function* (
      params: Schema.Schema.Type<typeof Parameters>,
      ctx: Tool.Context,
    ) {
      const cfg = yield* config.get()

      const ops = ctx.extra?.promptOps as TaskPromptOps
      if (!ops) return yield* Effect.fail(new Error("SwarmTool requires promptOps in ctx.extra"))

      const parent = yield* sessions.get(ctx.sessionID)
      let current = parent
      let depth = 0
      while (current.parentID) {
        depth++
        current = yield* sessions.get(current.parentID)
      }
      if (depth >= (cfg.subagent_depth ?? 1)) {
        return yield* Effect.fail(
          new Error(
            `Subagent depth limit reached (${cfg.subagent_depth ?? 1}). Increase "subagent_depth" to allow nested subagents.`,
          ),
        )
      }

      // Build the teammate team: explicit list, or derive from the goal via the coordinator.
      const teammates: TeammateConfig[] = []
      const tasks = new Map<TeammateRole, string>()
      if (params.teammates && params.teammates.length > 0) {
        for (const input of params.teammates) {
          teammates.push(new TeammateConfig({ role: input.role, model: input.model }))
          if (input.task) tasks.set(input.role, input.task)
        }
      } else {
        for (const role of deriveRolesForGoal(params.goal)) {
          teammates.push(new TeammateConfig({ role }))
        }
      }
      const plan = planSwarm(params.goal, teammates)
      const assigned = assignTasks(plan)
      for (const teammate of teammates) {
        if (!tasks.has(teammate.role)) {
          tasks.set(teammate.role, assigned.get(teammate.role) ?? `Help with: ${params.goal}`)
        }
      }

      if (!ctx.extra?.bypassAgentCheck) {
        yield* ctx.ask({
          permission: id,
          patterns: [...new Set(teammates.map((teammate) => teammate.role))],
          always: ["*"],
          metadata: {
            goal: params.goal,
            roles: teammates.map((teammate) => teammate.role),
          },
        })
      }

      const msg = yield* MessageV2.get({ sessionID: ctx.sessionID, messageID: ctx.messageID }).pipe(
        Effect.provideService(Database.Service, database),
        Effect.orDie,
      )
      if (msg.info.role !== "assistant") return yield* Effect.fail(new Error("Not an assistant message"))
      const variant = msg.info.variant
      const parentModel = { modelID: msg.info.modelID, providerID: msg.info.providerID }

      const runTeammate = Effect.fn("SwarmTool.runTeammate")(function* (teammate: TeammateConfig) {
        const task = tasks.get(teammate.role) ?? `Help with: ${params.goal}`
        const agentType = ROLE_AGENT[teammate.role] ?? "general"
        const next = yield* agent.get(agentType)
        if (!next) {
          return new TeammateResult({
            role: teammate.role,
            success: false,
            summary: `Unknown agent type for role '${teammate.role}': ${agentType} is not a valid agent type`,
            stepsCompleted: 0,
          })
        }

        const childPermission = deriveSubagentSessionPermission({
          parentSessionPermission: parent.permission ?? [],
          subagent: next,
        })
        const childToolDenies = [
          ...(next.permission.some((rule) => rule.permission === "todowrite")
            ? []
            : [{ permission: "todowrite" as const, pattern: "*" as const, action: "deny" as const }]),
          ...(next.permission.some((rule) => rule.permission === "task")
            ? []
            : [{ permission: "task" as const, pattern: "*" as const, action: "deny" as const }]),
          ...(next.permission.some((rule) => rule.permission === id)
            ? []
            : [{ permission: id, pattern: "*" as const, action: "deny" as const }]),
          ...(cfg.experimental?.primary_tools?.map((permission) => ({
            permission,
            pattern: "*" as const,
            action: "deny" as const,
          })) ?? []),
        ]
        const nextSession = yield* sessions.create({
          parentID: ctx.sessionID,
          title: `${teammate.role} teammate: ${params.goal}`,
          agent: next.name,
          permission: [
            ...childPermission,
            ...childToolDenies.filter(
              (deny) =>
                !childPermission.some(
                  (rule) =>
                    rule.permission === deny.permission && rule.pattern === deny.pattern && rule.action === deny.action,
                ),
            ),
          ],
        })

        const model = resolveTeammateModel(teammate.model, next.model ?? parentModel)

        const prompt = createTeammatePrompt(teammate, task)
        const parts = yield* ops.resolvePromptParts(prompt)
        const result = yield* ops.prompt({
          messageID: MessageID.ascending(),
          sessionID: nextSession.id,
          model: { modelID: model.modelID, providerID: model.providerID },
          variant: next.model || teammate.model ? undefined : variant,
          agent: next.name,
          parts,
        })
        const output = result.parts.findLast((item) => item.type === "text")?.text ?? ""
        const stepsCompleted = result.parts.filter((item) => item.type === "tool").length
        const summary =
          output.slice(0, 300) || `Teammate '${teammate.role}' completed without text output`
        return new TeammateResult({
          role: teammate.role,
          success: true,
          summary,
          stepsCompleted,
          output,
        })
      })

      const results = yield* Effect.forEach(
        teammates,
        (teammate) =>
          runTeammate(teammate).pipe(
            Effect.catchCause((cause) => {
              const error = Cause.squash(cause)
              return Effect.succeed(
                new TeammateResult({
                  role: teammate.role,
                  success: false,
                  summary: error instanceof Error ? error.message : String(error),
                  stepsCompleted: 0,
                }),
              )
            }),
          ),
        { concurrency: "unbounded" },
      )

      const summary = summarizeTeammateResults(results)

      yield* ctx.metadata({
        title: `Swarm: ${params.goal}`,
        metadata: {
          goal: params.goal,
          strategy: plan.strategy,
          summary,
          results: results.map((result) => ({
            role: result.role,
            success: result.success,
            summary: result.summary,
            stepsCompleted: result.stepsCompleted,
          })),
        },
      })

      return {
        title: `Swarm: ${params.goal}`,
        metadata: {
          goal: params.goal,
          strategy: plan.strategy,
          summary,
          results: results.map((result) => ({
            role: result.role,
            success: result.success,
            summary: result.summary,
            stepsCompleted: result.stepsCompleted,
          })),
        },
        output: JSON.stringify({ goal: params.goal, results, summary }, null, 2),
      }
    })

    return {
      description: DESCRIPTION,
      parameters: Parameters,
      jsonSchema: ToolJsonSchema.fromSchema(Parameters),
      execute: (params: Schema.Schema.Type<typeof Parameters>, ctx: Tool.Context) =>
        run(params, ctx).pipe(Effect.orDie),
    }
  }),
)