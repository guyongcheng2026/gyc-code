import { Effect } from "effect"
import type { DatabaseMigration } from "../migration"
import { TASK_TABLE_STATEMENT } from "../../session/task-table"

/**
 * 2026-09-30（每任务真实成本 P0 / C-01）：引入 task 实体。
 *
 * 在此之前成本只有会话与消息两个粒度，「完成一个 feature 花多少钱」算不出来。
 * 一条 task 对应一个用户轮次，由 projector 开/结算。
 */
export default {
  id: "20261001000000_task",
  up(tx) {
    return Effect.gen(function* () {
      yield* tx.run(TASK_TABLE_STATEMENT)
      yield* tx.run("CREATE INDEX IF NOT EXISTS `task_session_idx` ON `task` (`session_id`)")
      yield* tx.run("CREATE INDEX IF NOT EXISTS `task_created_idx` ON `task` (`time_created`)")
    })
  },
} satisfies DatabaseMigration.Migration