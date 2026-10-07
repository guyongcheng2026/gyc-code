/**
 * 事件表裁剪目标选取。
 *
 * 独立于 database.ts 是为了让这段纯逻辑可以在不拉起 `#sqlite` 条件导出与
 * 全局路径副作用的前提下被直接测试。
 */

/**
 * 按传入顺序（调用方须保证「最老优先」）累计字节，返回裁剪多少个会话才能
 * 覆盖超额字节数。返回值直接用作批量 DELETE 的 LIMIT，因此不做逐个会话删除。
 */
export const selectPruneTargetCount = (
  sessions: ReadonlyArray<{ bytes: number }>,
  overBytes: number,
): number => {
  let freed = 0
  let count = 0
  for (const session of sessions) {
    if (freed >= overBytes) break
    freed += session.bytes
    count++
  }
  return count
}
