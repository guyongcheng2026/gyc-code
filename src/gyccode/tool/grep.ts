import path from "path"
import { Effect, Schema } from "effect"
import { InstanceState } from "@/effect/instance-state"
import { FSUtil } from "@gyccode/core/fs-util"
import { Ripgrep } from "@gyccode/core/ripgrep"
import { assertExternalDirectoryEffect } from "./external-directory"
import DESCRIPTION from "./grep.txt"
import * as Tool from "./tool"

export const MATCH_LIMIT = 100

export const Parameters = Schema.Struct({
  pattern: Schema.String.annotate({ description: "The regex pattern to search for in file contents" }),
  path: Schema.optional(Schema.String).annotate({
    description: "The directory to search in. Defaults to the current working directory.",
  }),
  include: Schema.optional(Schema.String).annotate({
    description: 'File pattern to include in the search (e.g. "*.js", "*.{ts,tsx}")',
  }),
})

export const GrepTool = Tool.define(
  "grep",
  Effect.gen(function* () {
    const fs = yield* FSUtil.Service
    const ripgrep = yield* Ripgrep.Service
    return {
      description: DESCRIPTION,
      parameters: Parameters,
      execute: (params: { pattern: string; path?: string; include?: string }, ctx: Tool.Context) =>
        Effect.gen(function* () {
          const empty = {
            title: params.pattern,
            metadata: { matches: 0, truncated: false },
            // 语义必须与「内容搜索」一致：这里搜的是文件内容，不是文件本身。
            // 历史上此处返回 "No files found"，模型会读成「这个目录下没有文件」，
            // 进而判定目标文件/API 不存在并转而自己造一个。
            output: `No matches found for pattern /${params.pattern}/${
              params.path ? ` in ${params.path}` : ""
            }. The pattern does not occur in any searched file's contents. If you expected a match: widen the pattern, pass \`include\`, or point \`path\` at a different directory. Do not conclude the symbol or file does not exist from this result alone.`,
          }
          if (!params.pattern) {
            throw new Error("pattern is required")
          }

          yield* ctx.ask({
            permission: "grep",
            patterns: [params.pattern],
            always: ["*"],
            metadata: {
              pattern: params.pattern,
              path: params.path,
              include: params.include,
            },
          })

          const ins = yield* InstanceState.context
          const requested = path.isAbsolute(params.path ?? ins.directory)
            ? (params.path ?? ins.directory)
            : path.join(ins.directory, params.path ?? ".")
          const requestedInfo = yield* fs.stat(requested).pipe(Effect.catch(() => Effect.succeed(undefined)))
          yield* assertExternalDirectoryEffect(ctx, requested, {
            bypass: false,
            kind: requestedInfo?.type === "Directory" ? "directory" : "file",
          })

          const search = FSUtil.resolve(requested)
          const info = yield* fs.stat(search).pipe(Effect.catch(() => Effect.succeed(undefined)))
          const cwd = info?.type === "Directory" ? search : path.dirname(search)
          // 多取一条用于精确判定「是否还有更多结果」。Ripgrep.grep 的服务签名返回裸
          // 数组（ripgrep.ts:83），把内部算好的 truncated 标志丢掉了；此前只能靠
          // `rows.length === 100` 猜，恰好命中 100 条时会误报截断，更糟的是上游
          // 异常提前结束时会把部分结果当成完整结果。
          const result = yield* ripgrep.grep({
            cwd,
            pattern: params.pattern,
            include: params.include,
            limit: MATCH_LIMIT + 1,
          })
          const truncated = result.length > MATCH_LIMIT
          const matches = truncated ? result.slice(0, MATCH_LIMIT) : result
          if (matches.length === 0) return empty

          const rows = matches.map((item) => {
            const abs = path.resolve(
              requestedInfo?.type === "Directory" ? requested : path.dirname(requested),
              item.entry.path,
            )
            const rel = path.relative(ins.worktree, abs)
            return {
              path: rel && !rel.startsWith("..") ? rel : abs,
              line: item.line,
              text: item.text,
            }
          })

          const total = rows.length
          const hasMore = truncated
          const output = [`Found ${total} matches${hasMore ? " (more matches available)" : ""}`]

          let current = ""
          for (const match of rows) {
            if (current !== match.path) {
              if (current !== "") output.push("")
              current = match.path
              output.push(`${match.path}:`)
            }
            output.push(`  Line ${match.line}: ${match.text}`)
          }

          if (truncated) {
            output.push("")
            output.push("(Results truncated. Consider using a more specific path or pattern.)")
          }

          return {
            title: params.pattern,
            metadata: {
              matches: total,
              truncated,
            },
            output: output.join("\n"),
          }
        }).pipe(Effect.orDie),
    }
  }),
)
