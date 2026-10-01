import { Effect } from "effect"
import type { DatabaseMigration } from "../migration"
import { COST_LEDGER_INDEXES, COST_LEDGER_TABLE_STATEMENT } from "../../session/cost-ledger-table"

/**
 * 2026-10-01（C-05）：引入 cost_ledger 追加式成本流水。
 *
 * 解决两个问题：
 * 1. projector.ts 中有四处 `applyUsage(..., -1)` 回退，revert / 重投影会追溯改写
 *    历史成本，「今天花了多少」不是一个稳定值 —— 改为只增不改的流水。
 * 2. 成本没有成败维度时，算不出「完成一个 feature 的成本」。
 *
 * 建表语句复用 cost-ledger-table.ts 的常量（与 task-table.ts 同理）。
 */
export default {
  id: "20261001000001_cost_ledger",
  up(tx) {
    return Effect.gen(function* () {
      yield* tx.run(COST_LEDGER_TABLE_STATEMENT)
      for (const index of COST_LEDGER_INDEXES) yield* tx.run(index)
    })
  },
} satisfies DatabaseMigration.Migration
