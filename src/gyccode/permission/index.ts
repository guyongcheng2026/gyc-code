import { LayerNode } from "@gyccode/core/effect/layer-node"
import { ConfigPermissionV1 } from "@gyccode/core/v1/config/permission"
import { InstanceState } from "@/effect/instance-state"
import { Wildcard } from "@gyccode/core/util/wildcard"
import { Deferred, Duration, Effect, Layer, Context } from "effect"
import * as Option from "effect/Option"
import * as RefModule from "effect/Ref"
import os from "os"
import { PermissionV1 } from "@gyccode/core/v1/permission"
import { SessionID } from "@gyccode/schema/session-id"
import { EventV2Bridge } from "@/event-v2-bridge"
import { containsPath } from "@/project/instance-context"
import { Database } from "@gyccode/core/database/database"
import { PermissionDenialTable } from "@gyccode/core/session/sql"
import { resolveAction, writeDangerLevel, type PermissionAction, type PermissionMode } from "./modes"

export const Event = PermissionV1.Event

/**
 * A-4（对标指标 22 · 破坏性风险）：哪些权限的 pattern 是**文件路径**、需要工作目录围栏。
 *
 * 只对以路径为 pattern 的文件类权限生效——bash / webfetch 的 pattern 是命令或 URL，
 * 拿它们去比路径会误拒所有命令。
 */
const FENCED_PERMISSIONS = new Set(["edit", "write", "read", "patch", "notebook"])

const isFenceRelevant = (permission: string): boolean => FENCED_PERMISSIONS.has(permission)

/**
 * 审批等待上限（毫秒）。原先 `Deferred.await` 无任何超时，只要没有 reply 到达就永久挂起——
 * `gyc run` 这类非交互进程会连同整轮对话一起卡死，工具 part 也永远停在 `running`。
 * 超过上限按「没人应答」处理：自动拒绝，让工具失败并把控制权交回模型，而不是挂死。
 * 交互式 TUI 下人思考的时间通常远小于该上限，需要放宽时用环境变量覆盖。
 */
export const DEFAULT_ASK_TIMEOUT_MS = 30 * 60 * 1000

export const resolveAskTimeoutMs = (): number => {
  const raw = process.env.GYCCODE_PERMISSION_ASK_TIMEOUT_MS
  const parsed = raw === undefined ? Number.NaN : Number.parseInt(raw, 10)
  return Number.isFinite(parsed) && parsed > 0 ? parsed : DEFAULT_ASK_TIMEOUT_MS
}

/**
 * A-5（对标指标 22 · 审计）：把一次拒绝写入 `permission_denials`。
 *
 * 数据库在 layer 构建期解析并闭包捕获（node 已声明 Database.node 依赖），因此
 * 拒绝路径上没有任何额外依赖，也不会把服务解析失败带进 `ask()` 的错误通道。
 * 数据库缺席（早期启动、部分单测）时静默跳过——审计缺失不能反过来阻塞用户操作。
 */
const recordDenial = (
  database: Database.Interface | undefined,
  input: { sessionID: SessionID | undefined; permission: string; patterns: string[]; reason: string },
) =>
  Effect.gen(function* () {
    if (!database) return
    // 直接调用，落库失败（含表不存在）只记警告，不影响拒绝本身。
    yield* recordDenialRow(database, input)
  })

/**
 * A-5：写一条拒绝流水。独立成函数是为了能被单测直接驱动——它需要真实数据库实例，
 * 而 permission 的 layer 是通过 node 图注入数据库的，测试里手工装配很别扭。
 */
export const recordDenialRow = (
  database: Database.Interface,
  input: { sessionID: SessionID | undefined; permission: string; patterns: string[]; reason: string },
) =>
  database.db
    .insert(PermissionDenialTable)
    .values({
      id: PermissionV1.ID.ascending(),
      session_id: input.sessionID,
      permission: input.permission,
      patterns: input.patterns,
      reason: input.reason,
    })
    .pipe(
      Effect.catchCause((cause) =>
        Effect.logWarning("permission denial not recorded", {
          "session.id": input.sessionID,
          cause,
        }),
      ),
    )

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
    // A-5：数据库可选。生产环境 node 已声明依赖，这里取到实例后闭包捕获；
    // 单测只 provide 事件总线时取不到，落库自动跳过。
    const maybeDatabase = yield* Effect.serviceOption(Database.Service)
    const database = Option.isNone(maybeDatabase) ? undefined : maybeDatabase.value
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
      // A-3：dontAsk 对**所有**权限生效（不限于 write/bash 这三类登记过的），
      // 未命中 allow 的一律拒绝，绝不挂 Deferred 等用户。
      const isDontAsk = mode === "dontAsk"
      // A-4：工作目录围栏。文件类权限的路径必须落在 worktree 内，
      // 越界即 deny。用现成的 containsPath（走 FSUtil.contains，Windows 下
      // 大小写不敏感），不要自己造路径归一化。
      const instance = isFenceRelevant(request.permission) ? yield* InstanceState.context : undefined

      /** A-5：拒绝落库。写库失败绝不能影响拒绝本身，只记一条日志。 */
      const deny = (reason: string, ruleset: PermissionV1.Ruleset) =>
        Effect.gen(function* () {
          yield* recordDenial(database, {
            sessionID: request.sessionID,
            permission: String(request.permission),
            patterns: [...request.patterns],
            reason,
          })
          return yield* new PermissionV1.DeniedError({ ruleset })
        })

      for (const pattern of request.patterns) {
        if (instance && !containsPath(pattern, instance)) {
          return yield* deny("out_of_worktree", [
            { permission: request.permission, pattern, action: "deny" as const },
          ])
        }
        const rule = evaluate(request.permission, pattern, ruleset, approved)
        yield* Effect.logDebug("evaluated", { permission: request.permission, pattern, action: rule })
        // 安全侧优先：ruleset 的显式 deny 永远生效，bypassPermissions 也不覆盖它。
        // 用户手写的规则比模式开关更硬——模式放行不该推翻「我明确禁了这东西」。
        const deniedByMode = modeAction === "deny" || (isDontAsk && rule.action !== "allow")
        if (rule.action === "deny" || deniedByMode) {
          return yield* deny(
            deniedByMode ? `mode:${mode}` : "ruleset",
            [
              ...ruleset.filter((rule) => Wildcard.match(request.permission, rule.permission)),
              // 模式导致的拒绝补一条合成规则，让模型能从回灌文本里看出是模式
              // （plan / acceptEdits / ...）而非用户逐条手写的规则挡下的。
              ...(deniedByMode && rule.action !== "deny"
                ? [{ permission: request.permission, pattern: "*", action: "deny" as const, mode } as PermissionV1.Rule]
                : []),
            ],
          )
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
      const askTimeoutMs = resolveAskTimeoutMs()
      return yield* Effect.ensuring(
        Deferred.await(deferred).pipe(
          Effect.timeout(Duration.millis(askTimeoutMs)),
          // Effect.timeout 抛出的是内置 Cause.TimeoutError，换算为领域错误，
          // 否则调用方拿到的错误通道与接口声明不符（与 question/index.ts 一致）。
          Effect.catchTag("TimeoutError", () =>
            Effect.as(
              Effect.logWarning("permission ask timed out; auto rejecting", {
                "session.id": info.sessionID,
                id,
                permission: info.permission,
                patterns: info.patterns,
                timeoutMs: askTimeoutMs,
              }),
              new PermissionV1.RejectedError(),
            ),
          ),
        ),
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

export const node = LayerNode.make({
  service: Service,
  layer: layer,
  // A-5 需要写 permission_denials 表，故把数据库挂进节点依赖；在 layer 内部
  // provide 后 ask() 的 R 通道仍是 PermissionV1.Error，不污染调用方。
  deps: [EventV2Bridge.node, Database.node],
})

export { PermissionMode, PermissionAction, resolveAction } from "./modes"
export { DenialTracker } from "./classifier"

export * as Permission from "."
