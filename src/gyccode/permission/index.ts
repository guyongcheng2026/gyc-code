import { LayerNode } from "@gyccode/core/effect/layer-node"
import { ConfigPermissionV1 } from "@gyccode/core/v1/config/permission"
import { InstanceState } from "@/effect/instance-state"
import { Wildcard } from "@gyccode/core/util/wildcard"
import { Deferred, Effect, Layer, Context } from "effect"
import * as RefModule from "effect/Ref"
import os from "os"
import { PermissionV1 } from "@gyccode/core/v1/permission"
import { EventV2Bridge } from "@/event-v2-bridge"
import { resolveAction, writeDangerLevel, type PermissionAction, type PermissionMode } from "./modes"

export const Event = PermissionV1.Event

export interface Interface {
  readonly ask: (input: PermissionV1.AskInput) => Effect.Effect<void, PermissionV1.Error>
  readonly reply: (input: PermissionV1.ReplyInput) => Effect.Effect<void, PermissionV1.NotFoundError>
  readonly list: () => Effect.Effect<ReadonlyArray<PermissionV1.Request>>
  /** 当前权限模式。R-1：模式此前只存在于枚举里，没有任何读取入口。 */
  readonly mode: () => Effect.Effect<PermissionMode>
  /** 切换权限模式。仅内存态，不落盘。 */
  readonly setMode: (mode: PermissionMode) => Effect.Effect<void>
}

interface PendingEntry {
  info: PermissionV1.Request
  deferred: Deferred.Deferred<void, PermissionV1.RejectedError | PermissionV1.CorrectedError>
}

interface State {
  pending: RefModule.Ref<Map<PermissionV1.ID, PendingEntry>>
  // P0 修复：使用 Ref 包装 approved 数组，避免并发修改导致的数据竞争
  approved: RefModule.Ref<PermissionV1.Rule[]>
  // R-1：权限模式。默认 default——未显式设置时不得默认绕过任何询问。
  mode: RefModule.Ref<PermissionMode>
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

// 导出 layer 供测试装配：node 里只有 LayerNode，而测试需要单独 provide
// EventV2Bridge 桩，不能顺着 node 把真实事件总线一并拉起来。
export const layer = Layer.effect(
  Service,
  Effect.gen(function* () {
    const events = yield* EventV2Bridge.Service
    const stateCache = yield* InstanceState.make<State>(
      Effect.fn("Permission.state")(function* (ctx) {
        void ctx
        const state = {
          pending: yield* RefModule.make(new Map<PermissionV1.ID, PendingEntry>()),
          // P0 修复：使用 Ref 包装 approved 数组
          approved: yield* RefModule.make<PermissionV1.Rule[]>([]),
          // R-1：权限模式默认 default
          mode: yield* RefModule.make<PermissionMode>("default"),
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
      const approved = yield* RefModule.get(state.approved)
      const { ruleset, ...request } = input
      let needsAsk = false

      // R-1（对标指标 22 · 权限与沙箱边界 · P0）：模式裁决接进 ask()。
      // 只有登记在 writeDangerLevel 的写/执行类权限进模式裁决；读权限不受
      // 模式影响，否则 plan 模式连文件都读不了。
      //
      // 未登记的权限拿到 undefined 而**不是** allow：这里若默认放行，将来新增
      // 一类权限忘了登记就会静默变成「无需询问」，是典型的放行型回归。保守侧是
      // 让它沿用既有询问链路。
      const mode = yield* RefModule.get(state.mode)
      const level = writeDangerLevel(request.permission)
      const modeAction: PermissionAction | undefined =
        level === undefined ? undefined : resolveAction(level, mode)

      for (const pattern of request.patterns) {
        const rule = evaluate(request.permission, pattern, ruleset, approved)
        yield* Effect.logDebug("evaluated", { permission: request.permission, pattern, action: rule })
        // 安全侧优先：ruleset 的显式 deny 永远生效，bypassPermissions 也不覆盖它。
        // 用户手写的规则比模式开关更硬——模式放行不该推翻「我明确禁了这东西」。
        if (rule.action === "deny" || modeAction === "deny") {
          return yield* new PermissionV1.DeniedError({
            ruleset: [
              ...ruleset.filter((rule) => Wildcard.match(request.permission, rule.permission)),
              // 模式导致的拒绝补一条合成规则，让模型能从回灌文本里看出是模式
              // （plan / acceptEdits / ...）而非用户逐条手写的规则挡下的。
              ...(modeAction === "deny" && rule.action !== "deny"
                ? [{ permission: request.permission, pattern: "*", action: "deny" as const, mode } as PermissionV1.Rule]
                : []),
            ],
          })
        }
        // 模式放行同样按 allow 处理：不挂起、不询问。
        if (rule.action === "allow" || modeAction === "allow") continue
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

      // P0 修复：使用 RefModule.modify 原子更新 approved 数组
      if (existing.info.always.length > 0) {
        yield* RefModule.modify(state.approved, (approved) => {
          const newRules = existing.info.always.map((pattern) => ({
            permission: existing.info.permission,
            pattern,
            action: "allow" as const,
          }))
          return [approved.concat(newRules), approved] as const
        })
      }

      const approved = yield* RefModule.get(state.approved)
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

    const mode = Effect.fn("Permission.mode")(function* () {
      const state = yield* InstanceState.get(stateCache)
      return yield* RefModule.get(state.mode)
    })

    const setMode = Effect.fn("Permission.setMode")(function* (next: PermissionMode) {
      const state = yield* InstanceState.get(stateCache)
      yield* Effect.logInfo("permission mode changed", { mode: next })
      yield* RefModule.set(state.mode, next)
    })

    return Service.of({ ask, reply, list, mode, setMode })
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
