import { Effect } from "effect"
import type { DatabaseMigration } from "../migration"
import { TASK_TABLE_STATEMENT } from "../../session/task-table"

/**
 * 2026-09-30（每任务真实成本 P0 / C-01）：引入 task 实体。
 *
 * 建表语句复用 task-table.ts 的常量——它有两个消费方（全新库的 schema.gen.ts
 * 与此处），各写一份的话日后改列必然漏一边。
 */
export default {
  id: "20261001000000_task",
  up(tx) {
    return Effect.gen(function* () {
      yield* tx.run(TASK_TABLE_STATEMENT)
      yield* tx.run(`CREATE INDEX IF NOT EXISTS \`task_session_idx\` ON \`task\` (\`session_id\`)`)
      yield* tx.run(`CREATE INDEX IF NOT EXISTS \`task_created_idx\` ON \`task\` (\`time_created\`)`)
    })
  },
} satisfies DatabaseMigration.Migration
