// 注入快照会话级冻结：date/记忆/画像在会话首轮定型后不再重算，
// 保证第一条 user 消息跨轮字节 100% 稳定（CH 前缀不折断）。
// 语义：进程内存级快照——新会话吃到最新记忆；进程重启后重新定型一次。

export interface InjectSnapshot {
  readonly date: string
  readonly memories: string | undefined
}

const INJECT_FREEZE_MAX = 1000

/**
 * 按 sessionID 冻结注入快照：首次调用执行 compute 并缓存，后续同会话直接
 * 返回首轮结果（即使记忆库已更新、日期已跨天）——实时重算会改变第一条
 * user 消息字节，从该点折断整段 prompt 前缀缓存（实测断点 162K-175K）。
 */
export function freezeInject(
  snapshots: Map<string, InjectSnapshot>,
  sessionID: string,
  compute: () => InjectSnapshot,
): InjectSnapshot {
  const hit = snapshots.get(sessionID)
  if (hit) {
    // LRU touch：把命中项移到最新位，避免有界淘汰误删活跃会话
    snapshots.delete(sessionID)
    snapshots.set(sessionID, hit)
    return hit
  }
  const value = compute()
  if (snapshots.size >= INJECT_FREEZE_MAX) {
    const oldest = snapshots.keys().next().value
    if (oldest !== undefined) snapshots.delete(oldest)
  }
  snapshots.set(sessionID, value)
  return value
}
