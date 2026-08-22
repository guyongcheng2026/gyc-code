import { Effect, Schema } from "effect"
import * as Tool from "./tool"
import { Worktree } from "@/worktree"
import { InstanceState } from "@/effect/instance-state"
import DESCRIPTION from "./worktree.txt"

const EnterParameters = Schema.Struct({
  name: Schema.optional(
    Schema.String.annotate({
      description: "Optional name for the worktree. If omitted, a random slug is generated.",
    }),
  ),
})

const ExitParameters = Schema.Struct({
  directory: Schema.String.annotate({
    description: "The worktree directory to remove.",
  }),
})

const ListParameters = Schema.Struct({})

export const EnterWorktreeTool = Tool.define(
  "worktree_enter",
  Effect.gen(function* () {
    const worktree = yield* Worktree.Service

    return {
      description: DESCRIPTION,
      parameters: EnterParameters,
      execute: (params: Schema.Schema.Type<typeof EnterParameters>, _ctx: Tool.Context) =>
        Effect.gen(function* () {
          const ctx = yield* InstanceState.context
          if (ctx.project.vcs !== "git") {
            return {
              title: "Worktree 不可用",
              output: "Worktree 仅支持 Git 项目。",
              metadata: {} as Record<string, unknown>,
            }
          }

          const info = yield* worktree.create({
            ...(params.name ? { name: params.name } : {}),
          })

          return {
            title: `创建 Worktree: ${info.name}`,
            output: `已创建 worktree\n  目录: ${info.directory}${info.branch ? `\n  分支: ${info.branch}` : ""}`,
            metadata: {
              name: info.name,
              directory: info.directory,
              ...(info.branch ? { branch: info.branch } : {}),
            },
          }
        }).pipe(Effect.orDie),
    }
  }),
)

export const ExitWorktreeTool = Tool.define(
  "worktree_exit",
  Effect.gen(function* () {
    const worktree = yield* Worktree.Service

    return {
      description: DESCRIPTION,
      parameters: ExitParameters,
      execute: (params: Schema.Schema.Type<typeof ExitParameters>, _ctx: Tool.Context) =>
        Effect.gen(function* () {
          const removed = yield* worktree.remove({ directory: params.directory })
          return {
            title: removed ? "移除 Worktree" : "移除失败",
            output: removed
              ? `已移除 worktree: ${params.directory}`
              : `移除 worktree 失败: ${params.directory}`,
            metadata: { directory: params.directory, removed },
          }
        }).pipe(Effect.orDie),
    }
  }),
)

export const ListWorktreeTool = Tool.define(
  "worktree_list",
  Effect.gen(function* () {
    const worktree = yield* Worktree.Service

    return {
      description: DESCRIPTION,
      parameters: ListParameters,
      execute: (_params: Schema.Schema.Type<typeof ListParameters>, _ctx: Tool.Context) =>
        Effect.gen(function* () {
          const list = yield* worktree.list()
          const lines = list.map(
            (item) => `  ${item.name}  ${item.directory}${item.branch ? `  (${item.branch})` : ""}`,
          )
          return {
            title: `Worktree 列表 (${list.length})`,
            output:
              list.length === 0
                ? "无 worktree"
                : `Worktree 列表:\n${lines.join("\n")}`,
            metadata: { count: list.length, worktrees: list },
          }
        }).pipe(Effect.orDie),
    }
  }),
)
