import { Effect } from "effect"
import type { DatabaseMigration } from "../migration"
import { TASK_START_COST_ALTER } from "../../session/task-table"

/**
 * C-05：给 task 表补 start_cost。
 *
 * start_cost 是 task 表建好之后才加的列，跑过 20261001000000_task 的老库里没有它。
 * 不补的后果很隐蔽：settleTask 读到 undefined 时 task.cost 会被算成 session 全额，
 * 于是「任务成本」等于「会话总成本」，C-01 刚建立的粒度又白做了。
 */
export default {
  id: "20261001000002_task_start_cost",
  up(tx) {
    return Effect.gen(function* () {
      yield* tx.run(TASK_START_COST_ALTER)
    })
  },
} satisfies DatabaseMigration.Migration
