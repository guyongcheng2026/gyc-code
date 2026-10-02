export * as McpCatalog from "./mcp-catalog"

// 可审计的 MCP 服务器目录（P2-1）
//
// 与既有插件市场的区别是这个模块的设计目标。插件市场的条目只有
// name/version/description/author（plugin/marketplace.ts:9-16），装上去之后
// 用户无从知道它会读什么、写什么。这里强制每条目声明三件事：
//
//   transport   —— 用哪种传输、连到哪里
//   permissions —— 需要哪些能力（白名单前缀，见 PermissionPrefix）
//   dataFlow    —— 数据往哪走（出站/入站/落盘/凭据）
//
// 声明不是装饰：toConfig 只用声明里的 command/url 生成配置，装之前
// describeForReview 把三项摊开给用户看。CC 市场给不了这种预览。
import { Schema } from "effect"
import type { ConfigMCPV1 } from "../v1/config/mcp"


// 权限前缀白名单。刻意收紧：新增前缀要显式改这里，避免目录里写个
// 「read-everything」之类无法核对的大权限。
export const PERMISSION_PREFIXES = [
  "fs:read",
  "fs:write",
  "net:fetch",
  "process:exec",
  "env:read",
  "secrets:read",
  "db:query",
  "browser:control",
] as const

export const DATA_FLOWS = ["file-content", "conversation", "credentials", "code", "media", "none"] as const

const Permission = Schema.String.check(
  // 允许精确前缀（fs:read）或带作用域（fs:read:/home/x）
  Schema.isPattern(new RegExp(`^(${PERMISSION_PREFIXES.join("|")})(:|$)`)),
)

/** 传输与端点是否自洽：stdio 走 command，其余走 url */
export function matchesTransport(
  transport: string,
  command: ReadonlyArray<string> | undefined,
  url: string | undefined,
): boolean {
  if (transport === "stdio") return command !== undefined && command.length > 0 && url === undefined
  return url !== undefined && url.length > 0 && command === undefined
}

export const Entry = Schema.Struct({
  name: Schema.String.check(
    Schema.isMinLength(1),
    Schema.isPattern(/^[a-z0-9][a-z0-9-]*$/),
  ),
  description: Schema.String,
  transport: Schema.Literals(["stdio", "http", "sse", "ws"]),
  command: Schema.Array(Schema.String).pipe(Schema.optional),
  url: Schema.String.pipe(Schema.optional),
  permissions: Schema.NonEmptyArray(Permission),
  dataFlow: Schema.NonEmptyArray(Schema.Literals([...DATA_FLOWS])),
  repository: Schema.String.pipe(Schema.optional),
})
  // 传输与端点的自洽性由 decodeEntry 单独把关，见该函数注释
.annotate({ identifier: "McpCatalog.Entry" })

const decodeEntrySchema = Schema.decodeUnknownSync(Entry)

/**
 * 条目解码入口 = 结构校验 + 传输/端点自洽校验。
 *
 * 自洽校验单独做而不是塞进 schema check，是因为它是**跨字段**规则：
 * stdio 必须有 command 且无 url，http/sse/ws 必须有 url 且无 command。
 * 少这条约束，目录里一条写错的条目要到安装后才会以「连不上」的形式暴露，
 * 那时用户已经改完配置文件了。
 */
export function decodeEntry(input: unknown): Entry {
  const entry = decodeEntrySchema(input)
  if (!matchesTransport(entry.transport, entry.command, entry.url))
    throw new Error(
      `MCP 目录条目 ${entry.name} 的传输与端点不自洽：transport=${entry.transport}，` +
        `command=${entry.command === undefined ? "无" : "有"}，url=${entry.url === undefined ? "无" : "有"}。` +
        `stdio 需要 command，http/sse/ws 需要 url，且两者互斥。`,
    )
  return entry
}

export type Entry = Schema.Schema.Type<typeof Entry>

export type ServerConfig = ConfigMCPV1.Info

export const Catalog = { Entry, Permission, DATA_FLOWS, PERMISSION_PREFIXES }

export interface Interface {
  readonly entry: (name: string) => Entry | undefined
  readonly entryNames: () => string[]
  readonly search: (query: string) => Entry[]
  readonly toConfig: (name: string) => ServerConfig | undefined
}

export const of = (entries: ReadonlyArray<Entry>): Interface => {
  const index = new Map(entries.map((entry) => [entry.name, entry]))
  return {
    entry: (name) => index.get(name),
    entryNames: () => [...index.keys()],
    search: (query) => {
      const needle = query.trim().toLowerCase()
      if (needle.length === 0) return [...entries]
      return entries.filter(
        (entry) =>
          entry.name.toLowerCase().includes(needle) || entry.description.toLowerCase().includes(needle),
      )
    },
    toConfig: (name) => {
      const entry = index.get(name)
      if (entry === undefined) return undefined
      if (entry.transport === "stdio") {
        if (entry.command === undefined) return undefined
        return { type: "local", command: [...entry.command] }
      }
      if (entry.url === undefined) return undefined
      return { type: "remote", url: entry.url }
    },
  }
}

/** 权限去重且顺序稳定（按白名单顺序），保证展示与快照可比 */
export function normalize(permissions: ReadonlyArray<string>): ReadonlyArray<string> {
  const seen = new Set(permissions)
  return PERMISSION_PREFIXES.filter((prefix) =>
    [...seen].some((permission) => permission === prefix || permission.startsWith(`${prefix}:`)),
  )
}

/** 安装前的审查文案：把这台服务器「会拿到什么」完整摊开 */
export function describeForReview(entry: Entry): string {
  const lines = [
    `服务器：${entry.name}`,
    `说明：${entry.description}`,
    `传输：${entry.transport}${entry.command === undefined ? "" : `（${entry.command.join(" ")}）`}`,
    `所需权限：${normalize(entry.permissions).join("、")}`,
    `数据流向：${entry.dataFlow.join("、")}`,
  ]
  if (entry.url !== undefined) lines.push(`端点：${entry.url}`)
  if (entry.repository !== undefined) lines.push(`来源：${entry.repository}`)
  lines.push("确认无误后再执行安装。")
  return lines.join("\n")
}

/**
 * 内置目录。收的都是通用、用途明确、不需要额外凭据的服务，
 * 并且逐条标注权限与数据流向——宁可条目少，也不要塞看不懂的。
 */
export const Builtin = of([
  {
    name: "filesystem",
    description: "在指定目录内读写文件，用于让模型接触项目外的指定素材",
    transport: "stdio",
    command: ["npx", "-y", "@modelcontextprotocol/server-filesystem"],
    permissions: ["fs:read", "fs:write"],
    dataFlow: ["file-content", "code"],
    repository: "https://github.com/modelcontextprotocol/servers",
  },
  {
    name: "git",
    description: "查询提交历史与 blame，只读，不做任何写操作",
    transport: "stdio",
    command: ["uvx", "mcp-server-git"],
    permissions: ["fs:read", "process:exec"],
    dataFlow: ["code", "none"],
    repository: "https://github.com/modelcontextprotocol/servers",
  },
  {
    name: "fetch",
    description: "抓取网页正文，供模型引用外部资料",
    transport: "stdio",
    command: ["uvx", "mcp-server-fetch"],
    permissions: ["net:fetch"],
    dataFlow: ["conversation"],
    repository: "https://github.com/modelcontextprotocol/servers",
  },
  {
    name: "memory",
    description: "本地知识图谱记忆，长期沉淀对话结论",
    transport: "stdio",
    command: ["npx", "-y", "@modelcontextprotocol/server-memory"],
    permissions: ["fs:read", "fs:write"],
    dataFlow: ["conversation"],
    repository: "https://github.com/modelcontextprotocol/servers",
  },
] satisfies ReadonlyArray<Entry>)