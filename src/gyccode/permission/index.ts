import { LayerNode } from "@gyccode/core/effect/layer-node"
import { ConfigPermissionV1 } from "@gyccode/core/v1/config/permission"
import { InstanceState } from "@/effect/instance-state"
import { Wildcard } from "@gyccode/core/util/wildcard"
import { Deferred, Effect, Layer, Context } from "effect"
import * as RefModule from "effect/Ref"
import os from "os"
import { PermissionV1 } from "@gyccode/core/v1/permission"
import { EventV2Bridge } from "@/event-v2-bridge"

export const Event = PermissionV1.Event

export interface Interface {
  readonly ask: (input: PermissionV1.AskInput) => Effect.Effect<void, PermissionV1.Error>
  readonly reply: (input: PermissionV1.ReplyInput) => Effect.Effect<void, PermissionV1.NotFoundError>
  readonly list: () => Effect.Effect<ReadonlyArray<PermissionV1.Request>>
}

interface PendingEntry {
  info: PermissionV1.Request
  deferred: Deferred.Deferred<void, PermissionV1.RejectedError | PermissionV1.CorrectedError>
}

interface State {
  pending: RefModule.Ref<Map<PermissionV1.ID, PendingEntry>>
  approved: PermissionV1.Rule[]
}

export function evaluate(permission: string, pattern: string, ...rulesets: PermissionV1.Ruleset[]): PermissionV1.Rule {
  return (
    rulesets
      .flat()
      .findLast((rule) => Wildcard.match(permission, rule.permission) && Wildcard.match(pattern, rule.pattern)) ?? {
      action: "ask",
      permission,
      pattern: "*",
    }
  )
}

export class Service extends Context.Service<Service, Interface>()("@gyccode/Permission") {}

const layer = Layer.effect(
  Service,
  Effect.gen(function* () {
    const events = yield* EventV2Bridge.Service
    const stateCache = yield* InstanceState.make<State>(
      Effect.fn("Permission.state")(function* (ctx) {
        void ctx
        const state = {
          pending: yield* RefModule.make(new Map<PermissionV1.ID, PendingEntry>()),
          approved: [],
        }

        yield* Effect.addFinalizer(() =>
          Effect.gen(function* () {
            const entries = (yield* RefModule.get(state.pending)).entries()
            yield* RefModule.set(state.pending, new Map())
            for (const [, item] of entries) {
              yield* Deferred.fail(item.deferred, new PermissionV1.RejectedError())
            }
          }),
        )

        return state
      }),
    )

    const state = yield* InstanceState.get(stateCache)
    const ask = Effect.fn("Permission.ask")(function* (input: PermissionV1.AskInput) {
      const { approved } = state
      const { ruleset, ...request } = input
      let needsAsk = false

      for (const pattern of request.patterns) {
        const rule = evaluate(request.permission, pattern, ruleset, approved)
        yield* Effect.logDebug("evaluated", { permission: request.permission, pattern, action: rule })
        if (rule.action === "deny") {
          return yield* new PermissionV1.DeniedError({
            ruleset: ruleset.filter((rule) => Wildcard.match(request.permission, rule.permission)),
          })
        }
        if (rule.action === "allow") continue
        needsAsk = true
      }

      if (!needsAsk) return

      const id = request.id ?? PermissionV1.ID.ascending()
      const info: PermissionV1.Request = {
        id,
        sessionID: request.sessionID,
        permission: request.permission,
        patterns: request.patterns,
        metadata: request.metadata,
        always: request.always,
        tool: request.tool,
      }
      yield* Effect.logInfo("asking", { id, permission: info.permission, patterns: info.patterns })

      const deferred = yield* Deferred.make<void, PermissionV1.RejectedError | PermissionV1.CorrectedError>()
      yield* RefModule.modify(state.pending, (m) => { m.set(id, { info, deferred })
        return [undefined, m] as const
      })
      yield* events.publish(Event.Asked, info)
      return yield* Effect.ensuring(
        Deferred.await(deferred),
        RefModule.modify(state.pending, (m) => {
          m.delete(id)
          return [undefined, m] as const
        }),
      )
    })

    const reply = Effect.fn("Permission.reply")(function* (input: PermissionV1.ReplyInput) {
      const state = yield* InstanceState.get(stateCache)
      const { approved } = state
      const existing = yield* RefModule.get(state.pending).pipe(Effect.map((m) => m.get(input.requestID)))
      if (!existing) return yield* new PermissionV1.NotFoundError({ requestID: input.requestID })

      yield* RefModule.modify(state.pending, (m) => {
        m.delete(input.requestID)
        return [undefined, m] as const
      })
      yield* events.publish(Event.Replied, {
        sessionID: existing.info.sessionID,
        requestID: existing.info.id,
        reply: input.reply,
      })

      if (input.reply === "reject") {
        yield* Deferred.fail(
          existing.deferred,
          input.message
            ? new PermissionV1.CorrectedError({ feedback: input.message })
            : new PermissionV1.RejectedError(),
        )

        const toReject = (yield* RefModule.get(state.pending)).entries().filter(
          ([, item]) => item.info.sessionID === existing.info.sessionID,
        )
        yield* RefModule.modify(state.pending, (m) => {
          for (const [id, item] of toReject) m.delete(id)
          return [undefined, m] as const
        })
        for (const [id, item] of toReject) {
          yield* events.publish(Event.Replied, {
            sessionID: item.info.sessionID,
            requestID: item.info.id,
            reply: "reject",
          })
          yield* Deferred.fail(item.deferred, new PermissionV1.RejectedError())
        }
        return
      }

      yield* Deferred.succeed(existing.deferred, undefined)
      if (input.reply === "once") return

      for (const pattern of existing.info.always) {
        approved.push({
          permission: existing.info.permission,
          pattern,
          action: "allow",
        })
      }

      const toResolve = (yield* RefModule.get(state.pending)).entries().filter(([, item]) => {
        if (item.info.sessionID !== existing.info.sessionID) return false
        return item.info.patterns.every(
          (pattern) => evaluate(item.info.permission, pattern, approved).action === "allow",
        )
      })
      yield* RefModule.modify(state.pending, (m) => {
        for (const [id] of toResolve) m.delete(id)
        return [undefined, m] as const
      })
      for (const [, item] of toResolve) {
        yield* events.publish(Event.Replied, {
          sessionID: item.info.sessionID,
          requestID: item.info.id,
          reply: "always",
        })
        yield* Deferred.succeed(item.deferred, undefined)
      }
    })

    const list = Effect.fn("Permission.list")(function* () {
      const state = yield* InstanceState.get(stateCache)
      const pending = yield* RefModule.get(state.pending)
      return Array.from(pending.values(), (item) => item.info)
    })

    return Service.of({ ask, reply, list })
  }),
)

function expand(pattern: string): string {
  if (pattern.startsWith("~/")) return os.homedir() + pattern.slice(1)
  if (pattern === "~") return os.homedir()
  if (pattern.startsWith("$HOME/")) return os.homedir() + pattern.slice(5)
  if (pattern.startsWith("$HOME")) return os.homedir() + pattern.slice(5)
  return pattern
}

export function fromConfig(permission: ConfigPermissionV1.Info) {
  const ruleset: PermissionV1.Rule[] = []
  for (const [key, value] of Object.entries(permission)) {
    if (typeof value === "string") {
      ruleset.push({ permission: key, action: value, pattern: "*" })
      continue
    }
    ruleset.push(
      ...Object.entries(value).map(([pattern, action]) => ({ permission: key, pattern: expand(pattern), action })),
    )
  }
  return ruleset
}

export function merge(...rulesets: PermissionV1.Ruleset[]): PermissionV1.Rule[] {
  return rulesets.flat()
}

export function disabled(tools: string[], ruleset: PermissionV1.Ruleset): Set<string> {
  const edits = ["edit", "write", "apply_patch"]
  const reads = ["list_mcp_resources", "list_mcp_resource_templates", "read_mcp_resource"]
  return new Set(
    tools.filter((tool) => {
      const permission = edits.includes(tool) ? "edit" : reads.includes(tool) ? "read" : tool
      const rule = ruleset.findLast((rule) => Wildcard.match(permission, rule.permission))
      return rule?.pattern === "*" && rule.action === "deny"
    }),
  )
}

export function visibleTools<T>(tools: Record<string, T>, ruleset: PermissionV1.Ruleset): Record<string, T> {
  const hidden = disabled(Object.keys(tools), ruleset)
  return Object.fromEntries(Object.entries(tools).filter(([name]) => !hidden.has(name)))
}

export const node = LayerNode.make({ service: Service, layer: layer, deps: [EventV2Bridge.node] })

export { PermissionMode, PermissionAction, resolveAction } from "./modes"
export { DenialTracker } from "./classifier"

export * as Permission from "."
