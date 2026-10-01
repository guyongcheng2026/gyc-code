import { Client } from "@modelcontextprotocol/sdk/client/index.js"
import {
  CallToolResultSchema,
  ListToolsResultSchema,
  ToolSchema,
  type Tool as MCPToolDef,
} from "@modelcontextprotocol/sdk/types.js"
import { dynamicTool, jsonSchema, type JSONSchema7, type Tool } from "ai"
import { Effect } from "effect"

const DEFAULT_TIMEOUT = 30_000
const MAX_LIST_PAGES = 1_000
const MAX_TOOL_DESCRIPTION = 2_048

function truncateDescription(description: string) {
  if (description.length <= MAX_TOOL_DESCRIPTION) return description
  const cut = description.slice(0, MAX_TOOL_DESCRIPTION)
  const boundary = Math.max(cut.lastIndexOf(". "), cut.lastIndexOf("\n"))
  return (boundary > MAX_TOOL_DESCRIPTION * 0.5 ? cut.slice(0, boundary + 1) : cut) + "…"
}

const TolerantListToolsResultSchema = ListToolsResultSchema.extend({
  tools: ToolSchema.omit({ outputSchema: true }).array(),
})

export async function paginate<T, R extends { nextCursor?: string }>(
  list: (cursor?: string) => Promise<R>,
  items: (result: R) => T[],
) {
  const result: T[] = []
  const cursors = new Set<string>()
  let cursor: string | undefined

  for (let attempt = 0; attempt < MAX_LIST_PAGES; attempt++) {
    // P0 修复：使用 attempt 作为循环计数器，pageResult 作为 API 返回值
    const pageResult = await list(cursor)
    result.push(...items(pageResult))
    if (pageResult.nextCursor === undefined) return result
    if (cursors.has(pageResult.nextCursor)) throw new Error(`MCP list returned duplicate cursor: ${pageResult.nextCursor}`)
    cursors.add(pageResult.nextCursor)
    cursor = pageResult.nextCursor
  }

  throw new Error(`MCP list exceeded ${MAX_LIST_PAGES} pages`)
}

export function defs(client: Client, timeout?: number) {
  return listTools(client, timeout ?? DEFAULT_TIMEOUT).pipe(Effect.catch(() => Effect.void))
}

export function convertTool(mcpTool: MCPToolDef, client: Client, timeout?: number): Tool {
  const inputSchema: JSONSchema7 = {
    ...(mcpTool.inputSchema as JSONSchema7),
    type: "object",
    properties: (mcpTool.inputSchema.properties ?? {}) as JSONSchema7["properties"],
    additionalProperties: false,
  }

  return dynamicTool({
    description: truncateDescription(mcpTool.description ?? ""),
    inputSchema: jsonSchema(inputSchema),
    execute: async (args: unknown, options) => {
      const result = await client.callTool(
        {
          name: mcpTool.name,
          arguments: (args || {}) as Record<string, unknown>,
        },
        CallToolResultSchema,
        {
          resetTimeoutOnProgress: true,
          signal: options.abortSignal,
          timeout,
          // The MCP SDK only sends a progress token when this hook is present, enabling timeout resets.
          onprogress: () => {},
        },
      )
      if (result.isError)
        throw new Error(
          (result.content as Array<{ type: string; text: string }>)
            .flatMap((item) => (item.type === "text" ? [item.text] : []))
            .filter((text) => text.trim())
            .join("\n\n") || "MCP tool returned an error",
        )
      if ((result.content as unknown[]).length > 0 || result.structuredContent === undefined || result.structuredContent === null)
        return result
      return {
        ...result,
        content: [{ type: "text" as const, text: JSON.stringify(result.structuredContent) }],
      }
    },
  })
}

export function fetch<T extends { name: string }>(
  clientName: string,
  client: Client,
  list: (client: Client) => Promise<T[]>,
  label: string,
  key?: (item: T) => string,
) {
  return Effect.tryPromise({
    try: () => list(client),
    catch: (error) => error,
  }).pipe(
    Effect.tapError((error) =>
      Effect.logWarning(`failed to get ${label}`, {
        clientName,
        error: error instanceof Error ? error.message : String(error),
      }),
    ),
    Effect.map((items) => {
      const sanitizedClient = sanitize(clientName)
      // Escape both the separator and escape marker so `server:uri` keys remain unambiguous.
      const resourceClient = clientName.replaceAll("%", "%25").replaceAll(":", "%3A")
      return Object.fromEntries(
        items.map((item) => [
          key ? resourceClient + ":" + key(item) : sanitizedClient + ":" + sanitize(item.name),
          { ...item, client: clientName },
        ]),
      )
    }),
    Effect.orElseSucceed(() => undefined),
  )
}

export const sanitize = (value: string) => value.replace(/[^a-zA-Z0-9_-]/g, "_")

export const toolName = (clientName: string, name: string) => sanitize(clientName) + "_" + sanitize(name)

/** P1-6：一次工具名冲突——多个来源 sanitize 之后塌缩成同一个最终工具名 */
export interface McpToolNameConflict {
  /** 冲突后的最终工具名，也就是模型实际看到并调用的那个名字 */
  readonly tool: string
  /** 占用该名字的来源，按注册顺序排列；第一个生效，其余被覆盖 */
  readonly owners: readonly { readonly server: string; readonly raw: string }[]
}

/**
 * 按最终工具名聚合，检出命名冲突。
 *
 * `toolName` 会对 server 名与工具名做 `sanitize`，因此 `a.b` / `a-b`、
 * `read.file` / `read-file` 这类名字会塌缩成同一个 key；上层用这个 key
 * 建索引，后写者会静默覆盖先写者，模型只拿得到其中一个。
 */
export function findToolNameConflicts(
  servers: Iterable<{ readonly server: string; readonly tools: readonly { name: string }[] }>,
): McpToolNameConflict[] {
  const byTool = new Map<string, { server: string; raw: string }[]>()
  for (const { server, tools } of servers) {
    for (const tool of tools) {
      const key = toolName(server, tool.name)
      const owners = byTool.get(key) ?? []
      // 同一个 (server, raw) 重复出现不算冲突——那只是同一工具被列了两次
      if (owners.some((owner) => owner.server === server && owner.raw === tool.name)) continue
      owners.push({ server, raw: tool.name })
      byTool.set(key, owners)
    }
  }
  return [...byTool.entries()]
    .filter(([, owners]) => owners.length > 1)
    .map(([tool, owners]) => ({ tool, owners }))
}

/** 生成给模型看的中文冲突说明：必须点名「哪个 server 抢了哪个工具名」 */
export function describeToolNameConflict(conflict: McpToolNameConflict): string {
  const [winner, ...losers] = conflict.owners
  const owner = (item: { server: string; raw: string }) => `server "${item.server}" 的工具 "${item.raw}"`
  return [
    `【MCP 工具名冲突】工具名 "${conflict.tool}" 被多个 MCP server 同时抢占：`,
    conflict.owners.map(owner).join("；"),
    `。当前生效的是 ${owner(winner!)}，模型只能通过 "${conflict.tool}" 调用到它；`,
    losers.length > 0
      ? `${losers.map(owner).join("；")} 已被覆盖，无法通过原名访问。`
      : "同名工具已被覆盖，无法通过原名访问。",
    "如需使用被覆盖的实现，请提示用户修改 MCP server 名或工具名以消除冲突。",
  ].join("")
}

/**
 * 给工具定义挂上冲突说明。只复制 def 并追加描述，不改 name / inputSchema，
 * 这样普通模式与 code 模式的工具目录都能看到提示。
 */
export function withConflictNotice<T extends MCPToolDef>(def: T, notice: string): T {
  const description = [def.description, notice].filter((part) => part && part.trim()).join("\n\n")
  return { ...def, ...(description ? { description } : {}) }
}

export function prompts(client: Client, timeout?: number) {
  if (!client.getServerCapabilities()?.prompts) return Promise.resolve([])
  return paginate(
    (cursor) => client.listPrompts(cursor === undefined ? undefined : { cursor }, { timeout }),
    (result) => result.prompts,
  )
}

export function resources(client: Client, timeout?: number) {
  if (!client.getServerCapabilities()?.resources) return Promise.resolve([])
  return paginate(
    (cursor) => client.listResources(cursor === undefined ? undefined : { cursor }, { timeout }),
    (result) => result.resources,
  )
}

export function resourceTemplates(client: Client, timeout?: number) {
  if (!client.getServerCapabilities()?.resources) return Promise.resolve([])
  return paginate(
    (cursor) => client.listResourceTemplates(cursor === undefined ? undefined : { cursor }, { timeout }),
    (result) => result.resourceTemplates,
  )
}

function listTools(client: Client, timeout: number) {
  return Effect.tryPromise({
    try: () =>
      paginate(
        async (cursor) => {
          const params = cursor === undefined ? undefined : { cursor }
          try {
            return await client.listTools(params, { timeout })
          } catch (error) {
            if (!(error instanceof Error) || !isOutputSchemaValidationError(error)) throw error
            return client.request({ method: "tools/list", params }, TolerantListToolsResultSchema, { timeout })
          }
        },
        (result) => result.tools,
      ),
    catch: (error) => (error instanceof Error ? error : new Error(String(error))),
  })
}

function isOutputSchemaValidationError(error: Error) {
  return /can't resolve reference|resolves to more than one schema|outputSchema|schema.*reference|reference.*schema/i.test(
    error.message,
  )
}

export * as McpCatalog from "./catalog"
