import path from "path"
import { Effect, Schema } from "effect"
import { InstanceState } from "@/effect/instance-state"
import { FSUtil } from "@gyccode/core/fs-util"
import { Ripgrep } from "@gyccode/core/ripgrep"
import { assertExternalDirectoryEffect } from "./external-directory"
import DESCRIPTION from "./glob.txt"
import { emptyMatchNotice } from "./grep"
import * as Tool from "./tool"

export const Parameters = Schema.Struct({
  pattern: Schema.String.annotate({ description: "The glob pattern to match files against" }),
  path: Schema.optional(Schema.String).annotate({
    description: `The directory to search in. If not specified, the current working directory will be used. IMPORTANT: Omit this field to use the default directory. DO NOT enter "undefined" or "null" - simply omit it for the default behavior. Must be a valid directory path if provided.`,
  }),
})

export const GlobTool = Tool.define(
  "glob",
  Effect.gen(function* () {
    const fs = yield* FSUtil.Service
    const ripgrep = yield* Ripgrep.Service
    return {
      description: DESCRIPTION,
      parameters: Parameters,
      execute: (params: { pattern: string; path?: string }, ctx: Tool.Context) =>
        Effect.gen(function* () {
          // 空/纯空白 pattern 会让 ripgrep 报错或匹配到一切：入口直接拒绝，
          // 避免把"删除整个列表"这类空模式当成有效查询下发。
          if (!params.pattern.trim()) throw new Error("glob pattern must not be empty")
          const ins = yield* InstanceState.context
          yield* ctx.ask({
            permission: "glob",
            patterns: [params.pattern],
            always: ["*"],
            metadata: {
              pattern: params.pattern,
              path: params.path,
            },
          })

          let search = params.path ?? ins.directory
          search = path.isAbsolute(search) ? search : path.resolve(ins.directory, search)
          const info = yield* fs.stat(search).pipe(Effect.catch(() => Effect.succeed(undefined)))
          if (info?.type === "File") {
            throw new Error(`glob path must be a directory: ${search}`)
          }
          yield* assertExternalDirectoryEffect(ctx, search, {
            bypass: false,
            kind: "directory",
          })

          const limit = 100
          // 向 ripgrep 多要 1 条，只用于判断「是否还有更多」：若按 files.length === limit
          // 判等，恰好 100 个匹配时会误报「已截断」，把模型引向无意义地收窄 pattern。
          // 多要 1 条的代价仍是 O(limit)，没有变成 O(全部)。
          const files = yield* ripgrep.glob({ cwd: search, pattern: params.pattern, limit: limit + 1 })
          const truncated = files.length > limit
          const shown = truncated ? files.slice(0, limit) : files

          const output = []
          if (shown.length === 0) output.push(emptyMatchNotice(params.pattern, params.path))
          if (shown.length > 0) {
            output.push(
              ...shown.map((file) => {
                const abs = path.resolve(search, file.path)
                const rel = path.relative(ins.worktree, abs)
                return rel && !rel.startsWith("..") ? rel : abs
              }),
            )
            if (truncated) {
              output.push("")
              output.push(
                `(Results are truncated: showing first ${limit} results. Consider using a more specific path or pattern.)`,
              )
            }
          }

          return {
            title: path.relative(ins.worktree, search),
            metadata: {
              count: shown.length,
              truncated,
            },
            output: output.join("\n"),
          }
        }).pipe(Effect.orDie),
    }
  }),
)
