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
