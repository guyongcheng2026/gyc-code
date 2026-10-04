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
      // 幂等：SQLite 的 ADD COLUMN 不支持 IF NOT EXISTS，重复执行会抛
      // duplicate column name，而 migration.ts 没有 try/catch，会直接冒泡
      // 中断整条迁移链。task 表的建表语句与本迁移来自同一批提交，老库若已
      // 跑过建表迁移、其代码版本又含 start_cost，就正好落进这个区间。
      // 先查列再决定是否 ALTER，两种库都能安全通过。
      if (
        (yield* tx.all<{ name: string }>(`PRAGMA table_info(\`task\`)`)).some((column) => column.name === "start_cost")
      )
        return
      yield* tx.run(TASK_START_COST_ALTER)
    })
  },
} satisfies DatabaseMigration.Migration
