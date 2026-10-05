export * as ToolRegistry from "./registry"

import { ToolOutput, type ToolCall, type ToolDefinition, type ToolResultValue } from "@gyccode/llm"
import { Context, Effect, Layer, Scope } from "effect"
import { AgentV2 } from "../agent"
import { PermissionV2 } from "../permission"
import { SessionMessage } from "../session/message"
import { SessionSchema } from "../session/schema"
import { ToolOutputStore } from "../tool-output-store"
import { AttachmentStore } from "../attachment-store"
import { Wildcard } from "../util/wildcard"
import { ApplicationTools } from "./application-tools"
import { definition, permission, settle, validateName, type AnyTool, type RegistrationError } from "./tool"
import { Tools } from "./tools"
import { makeLocationNode } from "../effect/app-node"

export type ExecuteInput = {
  readonly sessionID: SessionSchema.ID
  readonly agent: AgentV2.ID
  readonly assistantMessageID: SessionMessage.ID
  readonly call: ToolCall
}

export interface Interface {
  readonly materialize: (
    permissions?: PermissionV2.Ruleset,
    /** 描述裁剪选项；缺省用保守阈值，工具数不超过阈值时不裁剪。 */
    trim?: TrimOptions,
  ) => Effect.Effect<Materialization>
  /** Internal registration capability exposed publicly only through Tools.Service. */
  readonly register: (tools: Readonly<Record<string, AnyTool>>) => Effect.Effect<void, RegistrationError, Scope.Scope>
}

export interface Materialization {
  readonly definitions: ReadonlyArray<ToolDefinition>
  readonly settle: (input: ExecuteInput) => Effect.Effect<Settlement, ToolOutputStore.Error>
}

export interface Settlement {
  readonly result: ToolResultValue
  readonly output?: ToolOutput
  readonly outputPaths?: ReadonlyArray<string>
}

export class Service extends Context.Service<Service, Interface>()("@gyccode/v2/ToolRegistry") {}

const registryLayer = Layer.effect(
  Service,
  Effect.gen(function* () {
    const applications = yield* ApplicationTools.Service
    const resources = yield* ToolOutputStore.Service
    const attachments = yield* AttachmentStore.Service
    type Registration = { readonly identity: object; readonly tool: AnyTool }
    const local = new Map<string, Array<{ readonly token: object; readonly registration: Registration }>>()

    const settleWith = Effect.fn("ToolRegistry.settle")(function* (input: ExecuteInput, advertised?: object) {
      const registration =
        local.get(input.call.name)?.at(-1)?.registration ?? applications.entries().get(input.call.name)
      if (!registration)
        return {
          result: {
            type: "error" as const,
            value: advertised ? `Stale tool call: ${input.call.name}` : `Unknown tool: ${input.call.name}`,
          },
        }
      if (advertised && registration.identity !== advertised)
        return { result: { type: "error" as const, value: `Stale tool call: ${input.call.name}` } }
      const pending = yield* settle(
        registration.tool,
        input.call,
        {
          sessionID: input.sessionID,
          agent: input.agent,
          assistantMessageID: input.assistantMessageID,
          toolCallID: input.call.id,
        },
        attachments,
      ).pipe(
        Effect.map((output) => ({ output })),
        Effect.catchTag("LLM.ToolFailure", (failure) =>
          Effect.succeed({ result: { type: "error" as const, value: failure.message } }),
        ),
      )
      if ("result" in pending) return pending
      const output = pending.output
      const bounded = yield* resources.bound({ sessionID: input.sessionID, toolCallID: input.call.id, output })
      const result = ToolOutput.toResultValue(bounded.output)
      if (result.type === "error")
        return bounded.outputPaths.length > 0 ? { result, outputPaths: bounded.outputPaths } : { result }
      return bounded.outputPaths.length > 0
        ? { result, output: bounded.output, outputPaths: bounded.outputPaths }
        : { result, output: bounded.output }
    })

    return Service.of({
      register: Effect.fn("ToolRegistry.register")(function* (tools) {
        const entries = Object.entries(tools)
        if (entries.length === 0) return
        yield* Effect.forEach(entries, ([name]) => validateName(name), { discard: true })
        yield* Effect.uninterruptible(
          Effect.gen(function* () {
            const token = {}
            for (const [name, tool] of entries)
              local.set(name, [...(local.get(name) ?? []), { token, registration: { identity: {}, tool } }])
            yield* Effect.addFinalizer(() =>
              Effect.sync(() => {
                for (const [name] of entries) {
                  const registrations = local.get(name)?.filter((registration) => registration.token !== token) ?? []
                  if (registrations.length > 0) local.set(name, registrations)
                  else local.delete(name)
                }
              }),
            )
          }),
        )
      }),
      materialize: Effect.fn("ToolRegistry.materialize")(function* (permissions = [], trim: TrimOptions = {}) {
        const registrations = new Map(applications.entries())
        for (const [name, entries] of local) {
          const registration = entries.at(-1)?.registration
          if (registration) registrations.set(name, registration)
        }
        for (const [name, registration] of registrations)
          if (whollyDisabled(permission(registration.tool, name), permissions)) registrations.delete(name)
        return {
          // 工具数超过阈值时对次要工具裁描述，默认阈值保守，不裁剪即保持既有行为。
          definitions: trimDefinitions(
            Array.from(registrations, ([name, registration]) => definition(name, registration.tool)),
            trim,
          ),
          settle: (input) => {
            const registration = registrations.get(input.call.name)
            if (registration) return settleWith(input, registration.identity)
            return Effect.succeed({ result: { type: "error", value: `Unknown tool: ${input.call.name}` } })
          },
        }
      }),
    })
  }),
)

const layer = Layer.effect(
  Tools.Service,
  Service.use((registry) => Effect.succeed(Tools.Service.of({ register: registry.register }))),
).pipe(Layer.provideMerge(registryLayer))

function whollyDisabled(action: string, rules: PermissionV2.Ruleset) {
  const rule = rules.findLast((rule) => Wildcard.match(action, rule.action))
  return rule?.resource === "*" && rule.effect === "deny"
}

export const node = makeLocationNode({
  service: Service,
  layer,
  deps: [ApplicationTools.node, ToolOutputStore.node, AttachmentStore.node],
})

export const toolsNode = makeLocationNode({
  service: Tools.Service,
  layer,
  deps: [ApplicationTools.node, ToolOutputStore.node, AttachmentStore.node],
})

// 工具定义裁剪（G-27-1）
//
// `materialize` 原本只做「整条工具禁用」，其余工具一律全量产出 definition。
// 工具数量随插件、MCP server、内置工具叠加增长后，定义本身就会挤占可观的上下文，
// 而其中相当一部分工具在单次会话里根本用不到。
//
// 这里做的是「按需收窄」而非「按需加载」：工具仍然全部对模型可见（避免模型误以为
// 某个工具不存在而绕道），只是把次要工具的描述压到首行，高频工具保留完整描述。
//
// 取舍说明：
// - 阈值默认保守。工具数不超过阈值时完全不裁剪，保证既有行为零回归。
// - 排序按工具名字典序，不依赖 Map 的迭代顺序，保证同样输入两次调用结果完全一致。
// - 裁剪只保留第一行。该行是各工具描述的摘要句，能力要点不丢；模型若需要细节，
//   调用该工具失败或返回空结果时再追问即可。

/** 超过这个工具数量才开始裁剪描述。保守取值：绝大多数会话不会触发。 */
export const DEFAULT_DESCRIPTION_TRIM_THRESHOLD = 40

/**
 * 高频工具名单，这些工具即使超过阈值也保留完整描述。
 *
 * 覆盖读文件、搜索、编辑、列目录、执行命令这几类几乎每个会话都会用到的工具，
 * 它们的描述被裁剪后对模型的负面影响最大。
 */
export const DEFAULT_FREQUENT_TOOLS: ReadonlyArray<string> = [
  "read",
  "write",
  "edit",
  "bash",
  "grep",
  "glob",
  "list",
  "todowrite",
  "todoread",
  "task",
]

export interface TrimOptions {
  /** 超过多少个工具才开始裁剪。缺省用 DEFAULT_DESCRIPTION_TRIM_THRESHOLD。 */
  readonly threshold?: number | undefined
  /** 高频工具名单。缺省用 DEFAULT_FREQUENT_TOOLS。 */
  readonly frequent?: ReadonlyArray<string> | undefined
}

/** 取首行；空描述原样返回。 */
const firstLine = (description: string) => {
  const index = description.search(/\r|\n/)
  return index === -1 ? description : description.slice(0, index)
}

/**
 * 按需裁剪工具描述。
 *
 * 纯函数：同样输入必然得到同样输出（顺序与内容都确定），便于单测。
 */
export function trimDefinitions(
  definitions: ReadonlyArray<ToolDefinition>,
  options: TrimOptions = {},
): ReadonlyArray<ToolDefinition> {
  // 非法阈值（0 / 负数 / NaN）一律夹到保守值，等同于不裁剪。
  const raw = options.threshold ?? DEFAULT_DESCRIPTION_TRIM_THRESHOLD
  const threshold = Number.isFinite(raw) && raw > 0 ? Math.floor(raw) : DEFAULT_DESCRIPTION_TRIM_THRESHOLD
  const frequent = new Set(options.frequent ?? DEFAULT_FREQUENT_TOOLS)

  // 按工具名字典序产出，不依赖调用方传入的顺序，也不依赖 Map 迭代顺序。
  const ordered = [...definitions].sort((left, right) => (left.name < right.name ? -1 : left.name > right.name ? 1 : 0))

  if (ordered.length <= threshold) return ordered

  return ordered.map((definition) => {
    if (frequent.has(definition.name)) return definition
    const trimmed = firstLine(definition.description)
    if (trimmed === definition.description) return definition
    return { ...definition, description: trimmed }
  })
}