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
            const summary =
              matches.length > 0
                ? matches.join("\n")
                : `No matching tools found. Available tools (${total}): ${tools.map((item) => item.id).join(", ")}`
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
