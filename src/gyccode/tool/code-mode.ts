import * as Tool from "./tool"
import { CallToolResultSchema, type CallToolResult } from "@modelcontextprotocol/sdk/types.js"
import { Cause, Effect, Ref, Schema } from "effect"
import { CodeMode, Tool as SandboxTool, toolError } from "@gyccode/codemode"
import { MCP } from "@/mcp"
import { McpCatalog } from "@/mcp/catalog"
import { Agent } from "@/agent/agent"
import { Session } from "@/session/session"
import { Permission } from "@/permission"
import { Plugin } from "@/plugin"

export const CODE_MODE_TOOL = "execute"

const DESCRIPTION = "Run a confined orchestration script with access to connected MCP tools."

// 受限解释器的资源边界。CodeMode.make 的 limits 全部可选、缺省即"无限制"，
// 若不显式传入，一段失控脚本（死循环 / 无限递归调用 MCP 工具 / 累积超大输出）
// 会拖垮整个会话进程。这里给出宽裕但有限的默认值：
// - timeoutMs：墙钟超时。单个 MCP 调用自带超时，此处约束脚本整体；10 分钟足够
//   覆盖多轮编排，同时阻断死循环。
// - maxToolCalls：工具调用次数上限。正常编排脚本远低于此值；500 次足以阻断
//   无限循环调用，又不会误伤合法的批量编排。
// - maxOutputBytes：模型可见输出的字节上限。解释器内部累积的字符串在此截断，
//   防止 OOM；最终进入上下文前仍会经过 message-v2 的工具输出截断层。
const CODE_MODE_TIMEOUT_MS = 10 * 60 * 1000
const CODE_MODE_MAX_TOOL_CALLS = 500
const CODE_MODE_MAX_OUTPUT_BYTES = 1024 * 1024

export const Parameters = Schema.Struct({
  code: Schema.String.annotate({
    description: "Script body executed by the confined interpreter.",
  }),
})

type CallEntry = { tool: string; status: "running" | "completed" | "error"; input?: Record<string, unknown> }

type Metadata = {
  toolCalls: CallEntry[]
  error?: boolean
}

type Attachment = NonNullable<Tool.ExecuteResult["attachments"]>[number]

type CatalogEntry = {
  path: string
  key: string
  server: string
  local: string
  tool: MCP.McpTool
}

function groupByServer(mcpTools: Record<string, MCP.McpTool>, servers: readonly string[]): Map<string, CatalogEntry[]> {
  const byLongest = [...servers].sort((a, b) => b.length - a.length)
  const groups = new Map<string, CatalogEntry[]>()
  for (const key of Object.keys(mcpTools).sort((a, b) => a.localeCompare(b))) {
    const server =
      byLongest.find((name) => key.startsWith(name + "_")) ?? (key.includes("_") ? key.slice(0, key.indexOf("_")) : key)
    const local = server && key.startsWith(server + "_") ? key.slice(server.length + 1) : key
    const entry: CatalogEntry = {
      path: `${server}.${local}`,
      key,
      server,
      local,
      tool: mcpTools[key]!,
    }
    groups.set(server, [...(groups.get(server) ?? []), entry])
  }
  return groups
}

export function describeCatalog(mcpTools: Record<string, MCP.McpTool>, servers: readonly string[]): string {
  return CodeMode.make({
    tools: toolTree(
      [...groupByServer(mcpTools, servers).values()].flat(),
      () => () => Effect.fail(toolError("Tool preview is not executable.")),
    ),
  }).instructions()
}

const lastSegment = (uri: string) => {
  const trimmed = uri.split(/[?#]/, 1)[0]!.replace(/\/+$/, "")
  const segment = trimmed.slice(trimmed.lastIndexOf("/") + 1)
  return segment.length > 0 ? segment : undefined
}

const dataUrl = (mime: string, base64: string) => `data:${mime};base64,${base64}`

function projectMcpResult(result: CallToolResult, collect: (attachment: Attachment) => void): unknown {
  const text: string[] = []
  let files = 0
  let images = 0
  const push = (attachment: Attachment) => {
    files += 1
    if (attachment.mime.startsWith("image/")) images += 1
    collect(attachment)
  }
  for (const block of result.content) {
    switch (block.type) {
      case "text":
        text.push(block.text)
        break
      case "image":
      case "audio":
        push({ type: "file", mime: block.mimeType, url: dataUrl(block.mimeType, block.data) })
        break
      case "resource": {
        if ("text" in block.resource) {
          text.push(block.resource.text)
          break
        }
        const mime = block.resource.mimeType ?? "application/octet-stream"
        push({ type: "file", mime, url: dataUrl(mime, block.resource.blob), filename: lastSegment(block.resource.uri) })
        break
      }
      case "resource_link":
        // A link is a reference, not fetchable media; hand it to the program instead of the attachment channel.
        text.push(`${block.name}: ${block.uri}`)
        break
    }
  }

  if (result.structuredContent !== undefined && result.structuredContent !== null) return result.structuredContent
  if (text.length > 0) return text.join("\n")
  if (files > 0) {
    const noun = files === images ? "image" : "file"
    return `[${files} ${noun}${files === 1 ? "" : "s"} attached to the result]`
  }
  return null
}

type Run = (input: unknown) => Effect.Effect<unknown, unknown>

function toolTree(catalog: readonly CatalogEntry[], run: (entry: CatalogEntry) => Run) {
  const tree: Record<string, Record<string, SandboxTool.Definition>> = {}
  for (const entry of catalog) {
    const namespace = (tree[entry.server] ??= {})
    namespace[entry.local] = SandboxTool.make({
      description: entry.tool.def.description ?? "",
      input: entry.tool.def.inputSchema as SandboxTool.JsonSchema,
      output: entry.tool.def.outputSchema as SandboxTool.JsonSchema | undefined,
      run: run(entry),
    })
  }
  return tree
}

const invokeChildTool = Effect.fn("CodeMode.invokeChildTool")(function* (input: {
  plugin: Plugin.Interface
  entry: CatalogEntry
  args: Record<string, unknown>
  callID: string
  ctx: Tool.Context
}) {
  yield* input.plugin.trigger(
    "tool.execute.before",
    { tool: input.entry.key, sessionID: input.ctx.sessionID, callID: input.callID },
    { args: input.args },
  )
  const result = yield* Effect.gen(function* () {
    yield* input.ctx.ask({ permission: input.entry.key, metadata: {}, patterns: ["*"], always: ["*"] })
    // Deliberately mirrors McpCatalog.convertTool's transport call so the MCP service stays free of tool-loop concerns.
    return yield* Effect.promise(async () => {
      const raw = await input.entry.tool.client.callTool(
        { name: input.entry.tool.def.name, arguments: input.args },
        CallToolResultSchema,
        {
          resetTimeoutOnProgress: true,
          signal: input.ctx.abort,
          timeout: input.entry.tool.timeout,
          // The MCP SDK only sends a progress token when this hook is present, enabling timeout resets.
          onprogress: () => {},
        },
      )
      if (raw.isError)
        throw new Error(
          (raw.content as Array<{ type?: string; text?: string }>)
            .flatMap((item) => (item.type === "text" && item.text ? [item.text] : []))
            .filter((text: string) => text.trim())
            .join("\n\n") || "MCP tool returned an error",
        )
      return raw
    })
  }).pipe(
    Effect.withSpan("Tool.execute", {
      attributes: {
        "tool.name": input.entry.key,
        "tool.call_id": input.callID,
        "session.id": input.ctx.sessionID,
        "message.id": input.ctx.messageID,
      },
    }),
  )
  yield* input.plugin.trigger(
    "tool.execute.after",
    { tool: input.entry.key, sessionID: input.ctx.sessionID, callID: input.callID, args: input.args },
    result,
  )
  return result
})

export const CodeModeTool = Tool.define(
  CODE_MODE_TOOL,
  Effect.gen(function* () {
    const mcp = yield* MCP.Service
    const agents = yield* Agent.Service
    const sessions = yield* Session.Service
    const plugin = yield* Plugin.Service

    const init: Tool.DefWithoutID<typeof Parameters, Metadata> = {
      description: DESCRIPTION,
      parameters: Parameters,
      execute: Effect.fn("CodeMode.execute")(function* (params, ctx) {
        if (ctx.abort.aborted) {
          return {
            title: CODE_MODE_TOOL,
            metadata: { toolCalls: [], error: true },
            output: "Execution cancelled.",
          } satisfies Tool.ExecuteResult<Metadata>
        }
        const agent = yield* agents.get(ctx.agent)
        const session = yield* sessions.get(ctx.sessionID).pipe(Effect.orDie)
        const ruleset = Permission.merge(agent.permission, session.permission ?? [])
        const mcpTools = Permission.visibleTools(yield* mcp.tools(), ruleset)
        const servers = Object.keys(yield* mcp.clients()).map(McpCatalog.sanitize)
        const catalog = [...groupByServer(mcpTools, servers).values()].flat()

        const calls: CallEntry[] = []
        const attachments: Attachment[] = []
        const publish = () =>
          ctx.metadata({ title: CODE_MODE_TOOL, metadata: { toolCalls: calls.map((c) => ({ ...c })) } })

        // 用 Effect.Ref 替代裸 let，防止并发竞态
        const childCallsRef = yield* Ref.make(0)
        const callTool = (entry: CatalogEntry) => (input: unknown) =>
          Effect.gen(function* () {
            const childCalls = yield* Ref.updateAndGet(childCallsRef, (n: number) => n + 1)
            const result = yield* invokeChildTool({
              plugin,
              entry,
              args: (input ?? {}) as Record<string, unknown>,
              callID: `${ctx.callID ?? entry.key}/${childCalls}`,
              ctx,
            })
            return projectMcpResult(result as CallToolResult, (attachment: Attachment) => void attachments.push(attachment))
          }).pipe(
            Effect.catchCause((cause) => {
              if (Cause.hasInterruptsOnly(cause)) return Effect.interrupt
              const error = Cause.squash(cause)
              return Effect.fail(toolError(error instanceof Error ? error.message : String(error), error))
            }),
          )

        const runtime = CodeMode.make({
          tools: toolTree(catalog, callTool),
          // 显式资源边界：CodeMode 的 limits 缺省即无限制，失控脚本（死循环 /
          // 无限递归调用 MCP 工具 / 累积超大输出）会拖垮会话进程。
          limits: {
            timeoutMs: CODE_MODE_TIMEOUT_MS,
            maxToolCalls: CODE_MODE_MAX_TOOL_CALLS,
            maxOutputBytes: CODE_MODE_MAX_OUTPUT_BYTES,
          },
          onToolCallStart: ({ index, name, input }) =>
            Effect.suspend(() => {
              const shown = (() => {
                if (input === null || input === undefined) return
                if (typeof input === "object" && !Array.isArray(input)) {
                  const value = input as Record<string, unknown>
                  return Object.keys(value).length > 0 ? value : undefined
                }
                return { input }
              })()
              calls[index] = { tool: name, status: "running", ...(shown ? { input: shown } : {}) }
              return publish()
            }),
          onToolCallEnd: ({ index, outcome }) =>
            Effect.suspend(() => {
              const current = calls[index]
              if (current) calls[index] = { ...current, status: outcome === "success" ? "completed" : "error" }
              return publish()
            }),
        })

        const abort = Effect.callback<void>((resume) => {
          if (ctx.abort.aborted) return resume(Effect.void)
          const handler = () => resume(Effect.void)
          ctx.abort.addEventListener("abort", handler, { once: true })
          return Effect.sync(() => ctx.abort.removeEventListener("abort", handler))
        })
        const cancelled = (): CodeMode.Result => ({
          ok: false,
          error: { kind: "ExecutionFailure", message: "Execution cancelled." },
          toolCalls: calls.map((call) => ({ name: call.tool })),
        })

        const result = yield* Effect.raceFirst(runtime.execute(params.code), abort.pipe(Effect.map(cancelled)))
        const logs = result.logs ?? []
        const withLogs = (text: string) => {
          if (logs.length === 0) return text
          return text.length > 0 ? `${text}\n\nLogs:\n${logs.join("\n")}` : `Logs:\n${logs.join("\n")}`
        }

        if (!result.ok) {
          if (ctx.abort.aborted) {
            return {
              title: CODE_MODE_TOOL,
              metadata: { toolCalls: calls, error: true },
              output: "Execution cancelled.",
            } satisfies Tool.ExecuteResult<Metadata>
          }
          const hints = (result.error.suggestions ?? []).filter((hint) => !result.error.message.includes(hint))
          return yield* Effect.fail(new Error(withLogs([result.error.message, ...hints].join("\n"))))
        }

        // The interpreter validates returned values as plain JSON, so stringify cannot throw;
        // it yields undefined only for a program that returns undefined.
        const output =
          typeof result.value === "string"
            ? result.value
            : (JSON.stringify(result.value, null, 2) ?? String(result.value))

        return {
          title: CODE_MODE_TOOL,
          metadata: { toolCalls: calls },
          output: withLogs(output),
          ...(attachments.length > 0 ? { attachments } : {}),
        } satisfies Tool.ExecuteResult<Metadata>
      }, Effect.orDie),
    }
    return init
  }),
)
