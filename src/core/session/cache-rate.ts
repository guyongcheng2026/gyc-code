/**
 * C-07：prompt 缓存命中率的唯一实现。
 *
 * 此前同一口径散在三处：`gyc db cache`（db.ts）、`gyc stats`、以及 TUI 的
 * dialog-cost.tsx（自己手写了一份前缀命中率）。三份算法迟早分叉，界面上显示的
 * 命中率就会和 CLI 报的对不上——「一个真指标被一个假指标遮住」的反面：一个真指标
 * 被三个版本遮住。
 *
 * 抽到 core 是因为 TUI 是独立 workspace 包，不能反向依赖 `src/cli`。
 * 调用方（db.ts）继续从原路径再导出，既有 import 不用改。
 */

export interface CacheRowLike {
  data: string
  time_created?: number | string
  session_id?: string | null
}

export interface PromptCacheStats {
  /** 含可解析 token 用量的消息数 */
  withTokens: number
  /** 总输入 token（含缓存命中），命中率分母 */
  totalInput: number
  /** 缓存命中读取 token，命中率分子 */
  cacheRead: number
  perMessage: { time: number; total: number; cached: number; sessionID: string }[]
  /** 窗口内相邻行的前缀命中累计：Σ min(cur.cached, prev.total) */
  prefixHit: number
  /** 窗口内相邻行的前缀基数累计：Σ prev.total（首行与窗口过期行不计入） */
  prefixBase: number
  /** 稳态前缀命中累计：在 prefixHit 基础上再剔除漂移事件行（classifyMiss 非 null） */
  steadyHit: number
  /** 稳态前缀基数累计 */
  steadyBase: number
}

export interface PerMessageRow {
  time: number
  total: number
  cached: number
}

export type CacheMissCause = "window-expiry" | "drift" | "partial-drift"

/** 服务商 prompt 缓存窗口阈值（DeepSeek 等约 5min/1h）。间隔超过它时缓存自然过期，
 * 下一轮必然 miss——即使前缀字节完全未变（物理限制，不是前缀漂移）。 */
export const CACHE_WINDOW_MS = 10 * 60 * 1000

/**
 * 分类低命中行的原因：
 * - window-expiry：与上一轮间隔超过缓存窗口 → 服务商缓存已过期（全 miss 或大
 *   部分丢失），前缀未变也会 miss——物理限制，不是前缀漂移。
 * - drift：间隔在窗口内却近乎全 miss → 前缀字节确实与上轮不同（记忆/技能/指令/工具集等变化）。
 * - partial-drift：间隔在窗口内、命中仍高，但较上轮总输入丢失超过 5% 且 >2K token
 *   → 前缀中段折断（实测记忆实时检索注入首条 user 的典型形态；此前 ratio<0.2
 *   的全 miss 阈值漏掉 79-94% 的部分漂移行）。
 * - null：增量正常或无上一轮可比（报告窗口首行无法判断，不再误标）。
 */
export function classifyMiss(
  prev: PerMessageRow | undefined,
  cur: PerMessageRow,
  windowMs = CACHE_WINDOW_MS,
): CacheMissCause | null {
  if (!prev) return null
  const prevRatio = prev.total > 0 ? prev.cached / prev.total : 1
  const ratio = cur.total > 0 ? cur.cached / cur.total : 0
  const inWindow = cur.time - prev.time <= windowMs
  if (ratio < 0.2 && prevRatio >= 0.8) return inWindow ? "drift" : "window-expiry"
  // 部分前缀丢失：上轮总输入中本轮未命中的部分（gap），对齐 cache-anchor 的
  // 双阈值（>5% 且 >2K），大新增行（gap 为负或很小）不会误标。gap 以双方总
  // 输入的较小值为基准：compact/截断后 cur.total 远小于 prev.total 时，直接用
  // prev.total 会把正常的上下文收缩误标为部分漂移。
  const gap = Math.min(prev.total, cur.total) - cur.cached
  const threshold = Math.max(2_000, prev.total * 0.05)
  if (gap > threshold) return inWindow ? "partial-drift" : "window-expiry"
  return null
}

/**
 * 统计 prompt 缓存命中率。
 *
 * 命中率分母 = 单条"总输入 token（含缓存命中）"= tokens.input + cache.read + cache.write，
 * 恰好还原 provider 上报的完整输入规模。不能用 AI SDK 的 tokens.total 作分母：
 * total 含 output/reasoning token，会把真实 CH 系统性低估（例如 input 10K + output 500，
 * 全命中时按 total=10500 只算出 95.2%，实际应为 100%）。
 */
export function promptCacheStats(rows: readonly CacheRowLike[]): PromptCacheStats {
  let input = 0
  let cacheRead = 0
  let withTokens = 0
  const perMessage: { time: number; total: number; cached: number; sessionID: string }[] = []
  for (const row of rows) {
    try {
      const data = JSON.parse(row.data) as {
        tokens?: { input?: unknown; total?: unknown; cache?: { read?: unknown; write?: unknown } }
        sessionID?: unknown
        info?: { sessionID?: unknown }
      }
      const t = data.tokens
      if (!t) continue
      const num = (v: unknown): number => (typeof v === "number" && Number.isFinite(v) ? Math.max(0, v) : 0)
      const cacheReadTokens = num(t.cache?.read)
      const cacheWriteTokens = num(t.cache?.write)
      const netInput = num(t.input)
      const totalInput =
        typeof t.input === "number" && Number.isFinite(t.input)
          ? netInput + cacheReadTokens + cacheWriteTokens
          : num(t.total)
      if (totalInput <= 0) continue
      withTokens++
      input += totalInput
      cacheRead += cacheReadTokens
      perMessage.push({
        time: Number(row.time_created ?? 0),
        total: totalInput,
        cached: cacheReadTokens,
        sessionID:
          typeof row.session_id === "string" && row.session_id !== ""
            ? row.session_id
            : typeof data.sessionID === "string"
              ? data.sessionID
              : typeof data.info?.sessionID === "string"
                ? data.info.sessionID
                : "",
      })
    } catch {
      // skip malformed rows
    }
  }
  // 前缀命中率：只衡量对「上一轮已有前缀」的命中——新增内容本就不可命中（不计入
  // 分母）；窗口过期（物理 miss）、报告首行与跨会话边界（无共同前缀）不计入。
  // 稳态健康线 ≥99.5%（128 块对齐滞后锚约 −0.1%）。rows 可能按时间降序（SQL
  // DESC）传入，先按 time 升序副本配对，避免倒序比较语义错误。
  let prefixHit = 0
  let prefixBase = 0
  let steadyHit = 0
  let steadyBase = 0
  const asc = [...perMessage].sort((a, b) => a.time - b.time)
  for (let i = 1; i < asc.length; i++) {
    const prev = asc[i - 1]!
    const cur = asc[i]!
    if (cur.time - prev.time > CACHE_WINDOW_MS) continue
    if (prev.sessionID === "" || cur.sessionID !== prev.sessionID) continue
    const hit = Math.min(cur.cached, prev.total)
    prefixHit += hit
    prefixBase += prev.total
    // 稳态口径：漂移事件行（字节变更折断，如工具描述/指令改动后的首轮）如实
    // 计入 prefixHit，但单列为事件——稳态行只保留前缀未变的轮次。
    if (classifyMiss(prev, cur) === null) {
      steadyHit += hit
      steadyBase += prev.total
    }
  }
  return { withTokens, totalInput: input, cacheRead, perMessage, prefixHit, prefixBase, steadyHit, steadyBase }
}
