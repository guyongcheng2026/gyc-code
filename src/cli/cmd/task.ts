/**
 * `gyc task list` — 任务粒度的成本与成败。
 *
 * `gyc stats` 按会话/模型聚合，回答「这个月花了多少」；但真正要回答的是
 * 「刚才那个 feature 花了多少、成了吗」。一个会话通常包含很多轮任务，
 * 混在一起看无从判断单次交付的代价，故此处直接读 TaskTable（task 投影写入）。
 */
import { Effect } from "effect"
import { effectCmd } from "../effect-cmd"
import { Database } from "@gyccode/core/database/database"
import * as TaskProjector from "@gyccode/core/session/task-projector"
import type { SessionSchema } from "@gyccode/core/session/schema"
import { Console } from "effect"
import { z } from "zod"

const ArgsSchema = z.object({
  session: z.string().optional(),
  limit: z.number().default(20),
  status: z.enum(["all", "success", "failed", "running"]).default("all"),
})

const STATUS_LABEL: Record<string, string> = {
  running: "进行中",
  success: "成功",
  failed: "失败",
}

const money = (value: number) => `$${value.toFixed(4)}`

const ListCommand = effectCmd({
  command: "list",
  describe: "列出任务及其成本、成败",
  builder: (yargs) =>
    yargs
      .option("session", { describe: "只看某个会话的任务", type: "string" })
      .option("limit", { describe: "显示最近 N 条（默认 20）", type: "number", default: 20 })
      .option("status", {
        describe: "按状态筛选：all / success / failed / running",
        type: "string",
        default: "all",
      }),
  handler: Effect.fn("Cli.task.list")(function* (args) {
    const parsed = ArgsSchema.safeParse(args)
    if (!parsed.success) {
      yield* Console.error(`参数无效：${parsed.error.issues[0]?.message ?? "未知参数"}`)
      return
    }
    const { session, limit, status } = parsed.data
    const { db } = yield* Database.Service

    const all = yield* TaskProjector.listTasks(db, session as SessionSchema.ID | undefined)
    const rows = (status === "all" ? all : all.filter((t) => t.status === status)).slice(0, limit)

    if (rows.length === 0) {
      yield* Console.log("没有匹配的任务。")
      return
    }

    let total = 0
    yield* Console.log("状态    成本      词元      耗时   标题")
    for (const row of rows) {
      total += row.cost
      const tokens =
        row.tokens_input + row.tokens_output + row.tokens_cache_read + row.tokens_cache_write
      const elapsed = row.time_completed === null ? null : row.time_completed - row.time_created
      const cost = money(row.cost)
      const dur = elapsed === null ? "-" : `${(elapsed / 1000).toFixed(0)}s`
      yield* Console.log(
        `${(STATUS_LABEL[row.status] ?? row.status).padEnd(6)}  ${cost.padEnd(8)}  ${`${tokens}`.padEnd(8)}  ${dur.padEnd(6)}  ${row.title}`,
      )
    }
    yield* Console.log("")
    yield* Console.log(`合计 ${rows.length} 个任务，成本 ${money(total)}`)
  }),
})

export const TaskCommand = effectCmd({
  command: "task",
  describe: "查看任务（用户轮次）粒度的成本与成败",
  builder: (yargs) => yargs.command(ListCommand).demandCommand(),
  handler: Effect.fn("Cli.task")(function* () {}),
})