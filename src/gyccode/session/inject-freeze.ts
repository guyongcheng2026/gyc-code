// 注入快照会话级冻结：date/记忆/画像在会话首轮定型后不再重算，
// 保证第一条 user 消息跨轮字节 100% 稳定（CH 前缀不折断）。
// 语义：进程内存级快照——新会话吃到最新记忆；进程重启后重新定型一次。

export interface InjectSnapshot {
  readonly date: string
  readonly memories: string | undefined
}

const INJECT_FREEZE_MAX = 1000

/** 会话级冻结快照表（prompt.ts 构建注入时读写，Session.remove 时清理）。 */
export const injectSnapshots = new Map<string, InjectSnapshot>()

/** Drop the inject snapshot for one session (used from Session.remove cleanup). */
export const dropInjectSnapshot = (sessionID: string): void => {
  injectSnapshots.delete(sessionID)
}

/**
 * 按 sessionID 冻结注入快照：首次调用执行 compute 并缓存，后续同会话直接
 * 返回首轮结果（即使记忆库已更新）——实时重算会改变第一条 user 消息字节，
 * 从该点折断整段 prompt 前缀缓存（实测断点 162K-175K）。
 * - freshDate：date 不参与永久冻结，与快照不一致（跨天）时单独滚动更新——
 *   跨天折断一次是原设计已接受的代价（见 prompt.ts 注入注释），memories 永久冻结。
 * - persistOnMiss=false：判定冻结后、跳过重取的取数窗口内快照被 LRU 淘汰
 *   （TOCTOU），本轮 compute 缺记忆源，只返回不写入，下轮按首轮重新定型，
 *   避免把空记忆污染成永久快照。
 */
export function freezeInject(
  snapshots: Map<string, InjectSnapshot>,
  sessionID: string,
  compute: () => InjectSnapshot,
  freshDate: string,
  persistOnMiss = true,
): InjectSnapshot {
  const hit = snapshots.get(sessionID)
  if (hit) {
    // LRU touch：把命中项移到最新位，避免有界淘汰误删活跃会话
    snapshots.delete(sessionID)
    const value = hit.date === freshDate ? hit : { date: freshDate, memories: hit.memories }
    snapshots.set(sessionID, value)
    return value
  }
  const value = compute()
  if (!persistOnMiss) return value
  if (snapshots.size >= INJECT_FREEZE_MAX) {
    const oldest = snapshots.keys().next().value
    if (oldest !== undefined) snapshots.delete(oldest)
  }
  snapshots.set(sessionID, value)
  return value
}
