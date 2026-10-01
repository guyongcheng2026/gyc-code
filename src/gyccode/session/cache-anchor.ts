import path from "path"
import fs from "fs"
import { Global } from "@gyccode/core/global"
import { logError } from "@core/observability/log-error"

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

/** 锚点持久化位置：重启后仍能对比上一轮的 cacheRead，否则漂移检测在首轮永远沉默。 */
export const ANCHOR_FILE = path.join(Global.Path.state, "cache-anchors.json")

/** 落盘最小间隔：每 step 都写会把 state 目录变成写盘热点。 */
const PERSIST_INTERVAL_MS = 30_000

type AnchorMap = Map<string, { cacheRead: number; inputTokens: number }>

/**
 * 2026-09-30（每任务成本 P2 / C-08）：锚点原先只存在进程内存里，重启即全部
 * 丢失——紧接着重启的第一轮拿不到 prev，缓存命中骤降会被静默漏报，而这恰恰是
 * 最该看见的一次。启动时从 state 目录恢复即可。
 */
export function loadCacheAnchors(): AnchorMap {
  try {
    const raw = fs.readFileSync(ANCHOR_FILE, "utf-8")
    const parsed = JSON.parse(raw) as Record<string, { cacheRead?: unknown; inputTokens?: unknown }>
    const anchors: AnchorMap = new Map()
    for (const [sessionID, entry] of Object.entries(parsed)) {
      const cacheRead = typeof entry?.cacheRead === "number" ? entry.cacheRead : undefined
      const inputTokens = typeof entry?.inputTokens === "number" ? entry.inputTokens : undefined
      if (cacheRead === undefined || inputTokens === undefined) continue
      if (cacheRead < 0 || inputTokens < 0) continue
      anchors.set(sessionID, { cacheRead, inputTokens })
      if (anchors.size >= ANCHOR_MAX) break
    }
    return anchors
  } catch {
    return new Map()
  }
}

let lastPersist = 0

/** 节流落盘；写失败只记日志——锚点只是观测信号，不该因此影响会话。 */
export function persistCacheAnchors(anchor: AnchorMap, now = Date.now()): void {
  if (now - lastPersist < PERSIST_INTERVAL_MS) return
  lastPersist = now
  const payload: Record<string, { cacheRead: number; inputTokens: number }> = {}
  for (const [sessionID, entry] of anchor) payload[sessionID] = entry
  try {
    fs.mkdirSync(path.dirname(ANCHOR_FILE), { recursive: true })
    fs.writeFileSync(ANCHOR_FILE, JSON.stringify(payload), "utf-8")
  } catch (error) {
    // 锚点只是观测信号，落盘失败不该影响会话；但必须留下痕迹，否则「锚点没生效」
    // 会变成一个查不到原因的现象。
    logError("cache-anchor.persist", error, { entries: Object.keys(payload).length })
  }
}

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
