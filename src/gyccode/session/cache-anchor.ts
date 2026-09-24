/**
 * Prompt cache drift detection  mirrors reference agent's
 * utils/promptCacheBreakDetection semantics with the two documented
 * thresholds: flag when cached-input tokens drop both >5% and >2K tokens
 * versus the previous request's cache read, indicating a prompt-cache break
 * (system prompt drift, compaction, or tool-shape changes).
 *
 * Costs/correctness: this is observability  it never changes request
 * behavior, only surfaces a signal the TUI/log layer can surface.
 */

export const CACHE_DRIFT_PERCENT_THRESHOLD = 5
export const CACHE_DRIFT_TOKEN_THRESHOLD = 2_000

export type CacheAnchor = {
  cacheRead: number
  inputTokens: number
}

export type CacheDrift = {
  percentDrop: number
  droppedTokens: number
  prevCacheRead: number
}

export function detectCacheDrift(input: {
  prevCacheRead?: number
  curCacheRead: number
  prevInputTokens?: number
}): CacheDrift | null {
  const { prevCacheRead, curCacheRead, prevInputTokens } = input
  if (prevCacheRead === undefined || prevCacheRead <= 0) return null
  if (curCacheRead >= prevCacheRead) return null

  const droppedTokens = prevCacheRead - curCacheRead
  const baseline = prevInputTokens ?? prevCacheRead
  if (baseline <= 0) return null

  const percentDrop = (droppedTokens / baseline) * 100
  const passesPercent = percentDrop > CACHE_DRIFT_PERCENT_THRESHOLD
  const passesTokens = droppedTokens > CACHE_DRIFT_TOKEN_THRESHOLD
  if (!passesPercent || !passesTokens) return null

  return { percentDrop, droppedTokens, prevCacheRead }
}

export function cacheDriftFromUsage(
  prev: { cacheRead?: number; inputTokens?: number } | undefined,
  cur: { cacheRead?: number; inputTokens?: number },
): CacheDrift | null {
  if (!prev) return null
  return detectCacheDrift({
    prevCacheRead: prev.cacheRead,
    curCacheRead: cur.cacheRead ?? 0,
    prevInputTokens: prev.inputTokens,
  })
}

const ANCHOR_MAX = 1000

/**
 * 会话级跨消息 drift 追踪：与「该会话上一次请求」的 cacheRead 比较。
 * 旧口径用当前消息的 step 累计作 prev——单 step 消息恒为 0，detectCacheDrift
 * 的 prevCacheRead<=0 短路使跨消息漂移 100% 漏检（实测 cacheDrift 告警 0 条）。
 * 每次调用后更新锚点为本次值；anchor 有界，超限淘汰最旧会话。
 */
export function trackCacheDrift(
  anchor: Map<string, { cacheRead: number; inputTokens: number }>,
  sessionID: string,
  cur: { cacheRead: number; inputTokens: number },
): CacheDrift | null {
  // 全零 usage（step-finish 缺 usage 时的空 Usage 兜底）不比较也不更新锚点：
  // 否则会拿 {0,0} 与真实基线比出 100% 骤降误报，并把锚点清零、漏掉下一次真实漂移。
  if (cur.inputTokens <= 0 && cur.cacheRead <= 0) return null
  const prev = anchor.get(sessionID)
  if (prev) {
    // LRU touch：命中项重排到最新位，避免活跃会话插入序冻结在首次位置、
    // 被后续新会话挤到最旧后误淘汰（与 inject-freeze 的 touch 行为对齐）。
    anchor.delete(sessionID)
  } else if (anchor.size >= ANCHOR_MAX) {
    const oldest = anchor.keys().next().value
    if (oldest !== undefined) anchor.delete(oldest)
  }
  anchor.set(sessionID, cur)
  return prev ? cacheDriftFromUsage(prev, cur) : null
}
