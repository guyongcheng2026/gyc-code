export * as GrepTool from "./grep"

import { ToolFailure } from "@gyccode/llm"
import { Effect, Layer, Schema } from "effect"
import path from "path"
import { makeLocationNode } from "../effect/app-node"
import { FileSystem } from "../filesystem"
import { FSUtil } from "../fs-util"
import { Location } from "../location"
import { PermissionV2 } from "../permission"
import { Ripgrep } from "../ripgrep"
import { RelativePath } from "../schema"
import { ToolRegistry } from "./registry"
import { Tool } from "./tool"
import { Tools } from "./tools"

export const name = "grep"

/** 默认命中上限；与模型侧 `src/gyccode/tool/grep.ts` 的 MATCH_LIMIT 取值一致。 */
export const DEFAULT_MATCH_LIMIT = 100

/**
 * 归一化调用方传入的命中上限：未传、非正数或非有限值一律回落到默认上限。
 * 修复缺口 G-27-2——旧实现直接回落到 `Number.MAX_SAFE_INTEGER`，命中数不可控。
 */
export const resolveMatchLimit = (limit?: number): number => {
  if (limit === undefined) return DEFAULT_MATCH_LIMIT
  if (!Number.isFinite(limit) || limit <= 0) return DEFAULT_MATCH_LIMIT
  return limit
}

export const Input = Schema.Struct({
  pattern: FileSystem.GrepInput.fields.pattern.annotate({
    description: "Regex pattern to search for in file contents",
  }),
  path: RelativePath.pipe(Schema.optional).annotate({
    description: "Relative directory to search. Defaults to the active Location.",
  }),
  include: FileSystem.GrepInput.fields.include.annotate({
    description: 'File glob to include in the search (for example, "*.js" or "*.{ts,tsx}")',
  }),
  limit: FileSystem.GrepInput.fields.limit.annotate({
    description: `Maximum matches to return. Defaults to ${DEFAULT_MATCH_LIMIT}.`,
  }),
})

export const Output = Schema.Array(FileSystem.Match)
type ModelOutput = typeof Output.Encoded

/**
 * 空结果文案，与 `src/gyccode/tool/grep.ts` 的 `emptyMatchNotice` 逐字一致（修复 H-04）。
 *
 * 旧的空结果占位文案会被读成“目录里根本没有任何文件”，实际只是 pattern 没有匹配到；
 * 这里把 pattern 与搜索目录一并回灌，让模型知道“搜的是什么、在哪搜的、没搜到”。
 */
export const emptyMatchNotice = (pattern: string, directory?: string): string =>
  `No matches found for pattern /${pattern}/${directory ? ` in ${directory}` : ""}. The pattern does not occur in any searched file's contents. If you expected a match: widen the pattern, pass \`include\`, or point \`path\` at a different directory. Do not conclude the symbol or file does not exist from this result alone.`

/** Format raw search matches into the familiar concise model output. */
export const toModelOutput = (output: ModelOutput, pattern: string, directory?: string) => {
  const lines = output.length === 0 ? [emptyMatchNotice(pattern, directory)] : [`Found ${output.length} matches`]
  let current = ""
  for (const match of output) {
    if (current !== match.entry.path) {
      if (current) lines.push("")
      current = match.entry.path
      lines.push(`${match.entry.path}:`)
    }
    lines.push(`  Line ${match.line}: ${match.text}`)
  }
  return lines.join("\n")
}

/** Grep leaf that defaults its filesystem root to the active Location. */
const layer = Layer.effectDiscard(
  Effect.gen(function* () {
    const tools = yield* Tools.Service
    const fs = yield* FSUtil.Service
    const ripgrep = yield* Ripgrep.Service
    const location = yield* Location.Service
    const permission = yield* PermissionV2.Service

    yield* tools
      .register({
        [name]: Tool.make({
          description:
            "Search file contents by regular expression within the active Location or an absolute managed tool-output file. Use a path to narrow the search, include to filter files by glob, and limit to bound the match count. Returns concise file resources, line numbers, and bounded line previews.",
          input: Input,
          output: Output,
          toModelOutput: ({ input, output }) => [
            {
              type: "text",
              text: toModelOutput(
                output.map((match) => ({
                  ...match,
                  entry: { ...match.entry, path: path.resolve(location.directory, match.entry.path) },
                })),
                input.pattern,
                input.path,
              ),
            },
          ],
          execute: (input, context) =>
            Effect.gen(function* () {
              yield* permission.assert({
                action: name,
                resources: [input.pattern],
                save: ["*"],
                metadata: {
                  root: ".",
                  path: input.path,
                  include: input.include,
                  limit: input.limit,
                },
                sessionID: context.sessionID,
                agent: context.agent,
                source: { type: "tool", messageID: context.assistantMessageID, callID: context.toolCallID },
              })
              const target = path.resolve(location.directory, input.path ?? ".")
              const info = yield* fs.stat(target).pipe(Effect.catch(() => Effect.succeed(undefined)))
              return yield* ripgrep
                .grep({
                  cwd: info?.type === "Directory" ? target : path.dirname(target),
                  pattern: input.pattern,
                  file: info?.type === "File" ? path.basename(target) : undefined,
                  include: input.include,
                  limit: resolveMatchLimit(input.limit),
                })
                .pipe(
                  Effect.map((result) =>
                    result.map((match) =>
                      FileSystem.Match.make({
                        ...match,
                        entry: FileSystem.Entry.make({
                          ...match.entry,
                          path: RelativePath.make(
                            path.relative(
                              location.directory,
                              path.resolve(
                                info?.type === "Directory" ? target : path.dirname(target),
                                match.entry.path,
                              ),
                            ),
                          ),
                        }),
                      }),
                    ),
                  ),
                )
            }).pipe(Effect.mapError(() => new ToolFailure({ message: `Unable to grep for ${input.pattern}` }))),
        }),
      })
      .pipe(Effect.orDie)
  }),
)

export const node = makeLocationNode({
  name: "tool/grep",
  layer,
  deps: [ToolRegistry.node, FSUtil.node, Ripgrep.node, Location.node, PermissionV2.node],
})
