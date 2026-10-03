import { Effect } from "effect"
import type { DatabaseMigration } from "../migration"
import {
  PERMISSION_DENIALS_INDEXES,
  PERMISSION_DENIALS_TABLE_STATEMENT,
} from "../../session/permission-denial-table"

/**
 * 2026-10-02 —— A-5：新增 permission_denials 表，记录被拒绝的权限请求。
 *
 * 起因：此前拒绝只落在内存 pending 与控制台日志，进程一退出就查不到「哪些命令
 * 反复被拒 / 是谁拒的」。Claude Code 有同名遥测，补上这张表后才有数据可统计。
 *
 * 追加式写入，永不 UPDATE/DELETE（会话删除时由外键级联清理）。
 */
export default {
  id: "20261001000003_permission_denials",
  up(tx) {
    return Effect.gen(function* () {
      yield* tx.run(PERMISSION_DENIALS_TABLE_STATEMENT)
      for (const index of PERMISSION_DENIALS_INDEXES) yield* tx.run(index)
    })
  },
} satisfies DatabaseMigration.Migration
