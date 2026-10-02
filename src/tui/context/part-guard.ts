/**
 * 孤儿 part 事件判定（store.part 无界增长的修复点）。
 *
 * 泄露路径：
 *   1. `message.updated` 超过 100 条时 shift 掉最旧消息，并 delete draft.part[oldest.id]；
 *   2. 该消息的 `message.part.updated` 事件若晚到（流式补发、重连补发、revert 后
 *      残留的迟到事件），原实现会因 `store.part[messageID]` 为 undefined 而
 *      **无条件重建** `[part]`，此后该 message 已不在 store.message 里，清理逻辑
 *      （淘汰/删除/LRU）再也遍历不到它 → 条目永久驻留。
 *   3. 长会话 + 频繁重连下反复触发，store.part 键数量单调增长。
 *
 * 判定：part 事件携带的 messageID 若不在该会话当前的 message 列表中，即为孤儿，
 * 直接丢弃而不写入 store。
 */

interface MessageLike {
  id: string
}

/**
 * 判断 part 事件是否属于「父消息已不在 store」的孤儿事件。
 *
 * store 中无该会话消息时同样返回 true：订阅建立前的迟到事件不应凭事件本身
 * 重建 part 条目（该会话一旦 sync 会从服务端完整水合，无需靠事件补）。
 */
export function isOrphanPartEvent(
  messages: ReadonlyArray<MessageLike> | undefined,
  messageID: string,
): boolean {
  if (!messageID) return true
  if (!messages) return true
  for (let i = 0; i < messages.length; i++) {
    if (messages[i]?.id === messageID) return false
  }
  return true
}
