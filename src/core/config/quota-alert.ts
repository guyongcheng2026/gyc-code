/**
 * G-28-4：跨维度累计额度告警的纯计算内核。
 *
 * 既有 `token_budget` 只会按**单会话**判定（llm.ts 的 Budget.Warning 分支），
 * 于是「这个项目这个月烧了多少」没有任何地方能回答 —— 单会话成本都还没超，
 * 钱包已经空了。这里补上**按项目**与**按时间窗口**两个维度的累计判定。
 *
 * 与 billing/reconciliation.ts 同理：只做计算，不碰数据库、不发网络。
 * 聚合口径的事实源由调用方（runner/llm.ts）从 cost_ledger ⋈ session 取出后喂进来，
 * 本模块不重造第二套统计口径。
 *
 * 约定与既有字段保持一致：
 * - 额度为 `undefined` 表示不限；`<= 0` 或非有限值同样按「未配置」处理，
 *   避免有人把 0 写成「禁止花钱」而误报。
 * - 阈值沿用 `alert_threshold` 的语义（0-1 比例），非法值回落 0.8。
 */

/** 时间窗口粒度：自然日或自然月。非法值按 month 回落。 */
export type QuotaWindow = "day" | "month"

/** 累计告警的作用域：按项目，或按整个时间窗口合计。 */
export type QuotaAlertScope = "project" | "window"

/** 累计告警的度量：成本或 token 数。 */
export type QuotaAlertMetric = "cost" | "tokens"

/** 跨维度额度阈值默认值，与单会话 `alert_threshold ?? 0.8` 对齐。 */
export const DEFAULT_QUOTA_ALERT_THRESHOLD = 0.8

/**
 * 本模块关心的 `token_budget` 子集。全部可选 —— 全空即代表未启用跨维度告警。
 * 直接复用既有 `Config.latest(configEntries, "token_budget")` 的结果，不新增查表。
 */
export type QuotaBudgetInput = {
  readonly project_cost_usd?: number
  readonly project_tokens_total?: number
  readonly window_cost_usd?: number
  readonly window_tokens_total?: number
  readonly quota_window?: QuotaWindow
  readonly quota_alert_threshold?: number
  /** 既有单会话阈值：新字段缺省时沿用它。 */
  readonly alert_threshold?: number
}

/**
 * 一行聚合用量，来自 cost_ledger ⋈ session 的单次分组查询：
 * - `cost` / `tokens`：该项目**全量**累计（不受窗口约束）
 * - `windowCost` / `windowTokens`：该项目在**当前窗口内**的累计
 */
export type QuotaUsage = {
  readonly project: string
  readonly cost: number
  readonly tokens: number
  readonly windowCost: number
  readonly windowTokens: number
}

/** 一次触发的明细，直接进 webhook payload。 */
export type QuotaAlert = {
  readonly scope: QuotaAlertScope
  readonly metric: QuotaAlertMetric
  /** scope=project 时是项目 ID；scope=window 时是窗口 key（如 2026-10）。 */
  readonly key: string
  readonly current: number
  readonly limit: number
  readonly ratio: number
  readonly threshold: number
  readonly message: string
}

export type QuotaWindowRange = {
  readonly granularity: QuotaWindow
  /** 窗口标识：自然日 YYYY-MM-DD，自然月 YYYY-MM。 */
  readonly key: string
  /** 窗口起点（毫秒，含）。 */
  readonly start: number
  /** 窗口终点（毫秒，不含）。 */
  readonly end: number
}

const pad = (value: number) => String(value).padStart(2, "0")

/**
 * 按本地时区计算自然日 / 自然月窗口。用本地时区而非 UTC，是为了让「今天」
 * 与用户看到的日历一致（既有 session 列表也是 toLocaleString 本地渲染）。
 */
export function quotaWindow(granularity: QuotaWindow | undefined, now: number): QuotaWindowRange {
  const kind: QuotaWindow = granularity === "day" || granularity === "month" ? granularity : "month"
  const date = new Date(now)
  const year = date.getFullYear()
  const month = date.getMonth()
  if (kind === "day") {
    return {
      granularity: "day",
      key: `${year}-${pad(month + 1)}-${pad(date.getDate())}`,
      start: new Date(year, month, date.getDate()).getTime(),
      end: new Date(year, month, date.getDate() + 1).getTime(),
    }
  }
  return {
    granularity: "month",
    key: `${year}-${pad(month + 1)}`,
    start: new Date(year, month, 1).getTime(),
    end: new Date(year, month + 1, 1).getTime(),
  }
}

/** 额度：undefined、<= 0 或非有限值都视为「未配置」。 */
function limitOf(value: number | undefined): number | undefined {
  return value !== undefined && Number.isFinite(value) && value > 0 ? value : undefined
}

/**
 * 阈值：优先 `quota_alert_threshold`，缺省沿用既有 `alert_threshold`，
 * 都没有或非法（<= 0 / > 1 / 非有限）一律回落 0.8。
 */
export function quotaAlertThreshold(quota: number | undefined, legacy: number | undefined): number {
  // 逐个候选往下取：写了但非法的值等价于没写，不该连累后面的合法值。
  for (const candidate of [quota, legacy]) {
    if (candidate !== undefined && Number.isFinite(candidate) && candidate > 0 && candidate <= 1) return candidate
  }
  return DEFAULT_QUOTA_ALERT_THRESHOLD
}

const cost = (value: number) => `$${value.toFixed(4)}`

// 固定 locale，避免运行环境不同导致告警文案不可比。
const tokens = (value: number) => Math.round(value).toLocaleString("en-US")

function alert(
  scope: QuotaAlertScope,
  metric: QuotaAlertMetric,
  key: string,
  current: number,
  limit: number,
  threshold: number,
): QuotaAlert | undefined {
  const ratio = current / limit
  if (ratio < threshold) return undefined
  const label = scope === "project" ? `项目 ${key}` : `窗口 ${key}`
  const used = metric === "cost" ? cost(current) : `${tokens(current)} tokens`
  const cap = metric === "cost" ? cost(limit) : `${tokens(limit)} tokens`
  const state = ratio >= 1 ? "已超出" : "已达"
  return {
    scope,
    metric,
    key,
    current,
    limit,
    ratio,
    threshold,
    message: `${label} 累计${metric === "cost" ? "成本" : "tokens"} ${used} ${state}额度 ${cap} 的 ${Math.round(ratio * 100)}%（阈值 ${Math.round(threshold * 100)}%）`,
  }
}

/**
 * 核心判定：输入按项目聚合的用量与配置，输出触发明细列表（空数组表示不触发）。
 *
 * - 项目维度逐项目独立累计，一个项目超了不会把别的项目拖下水。
 * - 窗口维度是所有项目在该窗口内的合计，只产出一条，避免按项目重复上报。
 */
export function quotaAlerts(input: {
  readonly budget: QuotaBudgetInput
  readonly usages: readonly QuotaUsage[]
  readonly now?: number
}): QuotaAlert[] {
  const { budget, usages } = input
  const projectCost = limitOf(budget.project_cost_usd)
  const projectTokens = limitOf(budget.project_tokens_total)
  const windowCost = limitOf(budget.window_cost_usd)
  const windowTokens = limitOf(budget.window_tokens_total)
  // 一个跨维度额度都没配 = 未启用，此时返回空数组，调用方据此省略 payload 字段。
  if (projectCost === undefined && projectTokens === undefined && windowCost === undefined && windowTokens === undefined)
    return []

  const threshold = quotaAlertThreshold(budget.quota_alert_threshold, budget.alert_threshold)
  const found: QuotaAlert[] = []

  if (projectCost !== undefined || projectTokens !== undefined) {
    for (const row of usages) {
      if (projectCost !== undefined) {
        const hit = alert("project", "cost", row.project, row.cost, projectCost, threshold)
        if (hit) found.push(hit)
      }
      if (projectTokens !== undefined) {
        const hit = alert("project", "tokens", row.project, row.tokens, projectTokens, threshold)
        if (hit) found.push(hit)
      }
    }
  }

  if (windowCost !== undefined || windowTokens !== undefined) {
    const range = quotaWindow(budget.quota_window, input.now ?? Date.now())
    const totalCost = usages.reduce((sum, row) => sum + row.windowCost, 0)
    const totalTokens = usages.reduce((sum, row) => sum + row.windowTokens, 0)
    if (windowCost !== undefined) {
      const hit = alert("window", "cost", range.key, totalCost, windowCost, threshold)
      if (hit) found.push(hit)
    }
    if (windowTokens !== undefined) {
      const hit = alert("window", "tokens", range.key, totalTokens, windowTokens, threshold)
      if (hit) found.push(hit)
    }
  }

  return found
}
