import { Effect } from "effect"
import type { DatabaseMigration } from "../migration"
import { ERROR_AUDIT_INDEXES, ERROR_AUDIT_TABLE_STATEMENT } from "../../observability/error-audit-table"

/**
 * —— 新增 error_audit 表，把 logError 的输出落库。
 *
 * 起因：logError 统一了控制台格式，但控制台输出不持久、不带会话维度，进程一关
 * 就没法回答「昨晚那批 500 到底是哪些 scope 出的」。落库后可以按 scope / session
 * 聚合。写入永远是 append-only。
 */
export default {
  id: "20261001000004_error_audit",
  up(tx) {
    return Effect.gen(function* () {
      yield* tx.run(ERROR_AUDIT_TABLE_STATEMENT)
      for (const index of ERROR_AUDIT_INDEXES) yield* tx.run(index)
    })
  },
} satisfies DatabaseMigration.Migration
