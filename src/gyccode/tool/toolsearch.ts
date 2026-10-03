import { Effect, Schema } from "effect"
import * as Tool from "./tool"
import DESCRIPTION from "./toolsearch.txt"

export const Parameters = Schema.Struct({
  query: Schema.String.annotate({
    description:
      'Query to find tools. Use "select:<tool_name>" for direct selection (comma-separated allowed), or keywords to search.',
  }),
  max_results: Schema.optional(Schema.Number).annotate({
    description: "Maximum number of results to return (default: 5)",
  }),
})

export type SearchToolSource = {
  id: string
  description: string
}

export function searchTools(
  query: string,
  tools: readonly SearchToolSource[],
  maxResults: number,
): string[] {
  const selectMatch = query.match(/^select:(.+)$/i)
  if (selectMatch) {
    const requested = selectMatch[1]!.split(",").map((item) => item.trim()).filter(Boolean)
    const found: string[] = []
    for (const name of requested) {
      const tool = tools.find((item) => item.id === name)
      if (tool && !found.includes(tool.id)) found.push(tool.id)
    }
    return found
  }

  const terms = query.toLowerCase().split(/\s+/).filter(Boolean)
  if (terms.length === 0) return []

  const scored = tools
    .map((tool) => {
      const haystack = `${tool.id} ${tool.description}`.toLowerCase()
      let score = 0
      for (const term of terms) {
        if (tool.id.toLowerCase().includes(term)) score += 3
        if (haystack.includes(term)) score += 1
      }
      return { tool, score }
    })
    .filter((item) => item.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, maxResults)

  return scored.map((item) => item.tool.id)
}

// 归一化：统一小写，把下划线/中划线等分隔符视作空格，便于按词元比较
function normalize(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim()
}

// 字符二元组（bigram）：衡量「拼写相近」不受词长影响，比整串包含更抗噪
function bigrams(text: string): Set<string> {
  const chars = text.replace(/\s+/g, "")
  const out = new Set<string>()
  if (chars.length === 1) out.add(chars)
  for (let i = 0; i + 1 < chars.length; i++) out.add(chars.slice(i, i + 2))
  return out
}

// 低于该相似度的候选视为无关，宁可不给也不硬凑
const MIN_NEAR_SCORE = 0.3

/**
 * 零命中时给出的「邻近工具」：按工具名与 query 的二元组重合度打分，并对
 * 分组前缀（如 git_、mcp_）加权；结果不足 n 个时，用同前缀的兄弟工具补齐，
 * 让模型仍能看到一个工具族，但总量始终受 n 限制，不泄漏全量目录。
 */
export function nearestTools(
  query: string,
  tools: readonly SearchToolSource[],
  n: number,
): string[] {
  const normalized = normalize(query)
  const terms = normalized.split(/\s+/).filter(Boolean)
  if (terms.length === 0) return []
  const queryGrams = bigrams(normalized)
  const scored = tools
    .map((tool) => {
      const id = normalize(tool.id)
      const groups = id.split(/\s+/).filter(Boolean)
      // 只有一个词的工具没有分组前缀可言
      const prefix = groups.length > 1 ? groups[0]! : ""
      let hits = 0
      for (const gram of queryGrams) if (bigrams(id).has(gram)) hits++
      let score = queryGrams.size > 0 ? hits / queryGrams.size : 0
      for (const term of terms) {
        if (id.includes(term)) score += 0.6
        if (prefix && term.startsWith(prefix)) score += 0.8
        else if (prefix && prefix.startsWith(term)) score += 0.5
      }
      if (prefix && normalized.includes(prefix)) score += 0.4
      return { id: tool.id, group: prefix, score }
    })
    .filter((item) => item.score >= MIN_NEAR_SCORE)
    .sort((a, b) => b.score - a.score)

  const picked = scored.slice(0, n)
  const groups = new Set(picked.map((item) => item.group).filter(Boolean))
  // 同族补齐：从全量工具里取同前缀的兄弟工具（按原始顺序，保证结果稳定），
  // 这样拼错时也能看到「这一族还有哪些工具」，而不是直接空着。
  for (const tool of tools) {
    if (picked.length >= n || groups.size === 0) break
    if (picked.some((entry) => entry.id === tool.id)) continue
    const words = normalize(tool.id).split(/\s+/).filter(Boolean)
    const prefix = words.length > 1 ? words[0]! : ""
    if (prefix && groups.has(prefix)) picked.push({ id: tool.id, group: prefix, score: 0 })
  }
  return picked.map((item) => item.id)
}

export const ToolSearchTool = (
  sources: () => Effect.Effect<readonly SearchToolSource[]>,
) =>
  Tool.define(
    "tool_search",
    Effect.gen(function* () {
      return {
        description: DESCRIPTION,
        parameters: Parameters,
        execute: (params: Schema.Schema.Type<typeof Parameters>, _ctx: Tool.Context) =>
          Effect.gen(function* () {
            const tools = yield* sources()
            const matches = searchTools(params.query, tools, params.max_results ?? 5)
            const total = tools.length
            // 零命中兜底：只给「换个词」的建议 + 邻近工具，绝不列全量清单——
            // 全量 id 会把工具目录灌进上下文，诱发模型照着目录瞎猜工具名。
            const nearby =
              matches.length > 0
                ? []
                : nearestTools(params.query, tools, Math.min(5, params.max_results ?? 5))
            const summary =
              matches.length > 0
                ? matches.join("\n")
                : [
                    "未找到匹配的工具：请换个更短或更具体的关键词再试，或用 select:<tool_name> 直接指定工具名。",
                    nearby.length > 0
                      ? `邻近工具（按名称相近度）：${nearby.join("、")}`
                      : "没有名称相近的工具，请改用功能词检索，例如「读取 文件」「搜索 内容」「执行 命令」。",
                  ].join("\n")
            return {
              title: `${matches.length} tool${matches.length === 1 ? "" : "s"} matched`,
              output: [
                `Query: ${params.query}`,
                `Matches (${matches.length}/${total} tools):`,
                summary,
              ].join("\n"),
              metadata: { matches, query: params.query },
            }
          }).pipe(Effect.orDie),
      } satisfies Tool.DefWithoutID<typeof Parameters>
    }),
  )
