import { describe, expect, test } from "bun:test"
import {
  DEFAULT_QUOTA_ALERT_THRESHOLD,
  quotaAlerts,
  quotaAlertThreshold,
  quotaWindow,
  type QuotaBudgetInput,
  type QuotaUsage,
} from "./quota-alert"

const usage = (project: string, cost: number, tokens: number, windowCost = cost, windowTokens = tokens): QuotaUsage => ({
  project,
  cost,
  tokens,
  windowCost,
  windowTokens,
})

const budget = (over: Partial<QuotaBudgetInput> = {}): QuotaBudgetInput => ({
  ...over,
})

const NOW = new Date(2026, 9, 4, 12, 0, 0).getTime() // 2026-10-04 12:00 本地时间

describe("quotaWindow（自然日 / 自然月）", () => {
  test("按月时窗口 key 是 YYYY-MM，起点是当月 1 日 00:00", () => {
    const w = quotaWindow("month", NOW)
    expect(w.key).toBe("2026-10")
    expect(new Date(w.start).getDate()).toBe(1)
    expect(new Date(w.start).getHours()).toBe(0)
  })

  test("按日时窗口 key 是 YYYY-MM-DD，起点是当天 00:00", () => {
    const w = quotaWindow("day", NOW)
    expect(w.key).toBe("2026-10-04")
    expect(new Date(w.start).getHours()).toBe(0)
  })

  test("非法粒度回落为 month", () => {
    expect(quotaWindow("nope" as never, NOW).key).toBe("2026-10")
  })
})

describe("quotaAlertThreshold（阈值回落）", () => {
  test("未配置时默认 0.8，与单会话告警同一默认值", () => {
    expect(quotaAlertThreshold(undefined, undefined)).toBe(0.8)
    expect(DEFAULT_QUOTA_ALERT_THRESHOLD).toBe(0.8)
  })

  test("新阈值缺省时沿用既有 alert_threshold", () => {
    expect(quotaAlertThreshold(undefined, 0.5)).toBe(0.5)
  })

  test("非法阈值（<=0 / >1 / 非有限）一律回落 0.8", () => {
    expect(quotaAlertThreshold(0, undefined)).toBe(0.8)
    expect(quotaAlertThreshold(-1, undefined)).toBe(0.8)
    expect(quotaAlertThreshold(1.5, undefined)).toBe(0.8)
    expect(quotaAlertThreshold(Number.NaN, undefined)).toBe(0.8)
    expect(quotaAlertThreshold(Number.POSITIVE_INFINITY, undefined)).toBe(0.8)
  })

  test("非法的新阈值不会连累合法的 alert_threshold", () => {
    expect(quotaAlertThreshold(Number.NaN, 0.6)).toBe(0.6)
  })
})

describe("quotaAlerts（跨维度累计判定）", () => {
  test("窗口内累计超阈值触发", () => {
    const alerts = quotaAlerts({
      budget: budget({ window_cost_usd: 10, quota_window: "month" }),
      usages: [usage("p1", 100, 0, 8, 0)],
      now: NOW,
    })
    expect(alerts).toHaveLength(1)
    expect(alerts[0]!.scope).toBe("window")
    expect(alerts[0]!.metric).toBe("cost")
    expect(alerts[0]!.key).toBe("2026-10")
    expect(alerts[0]!.ratio).toBeCloseTo(0.8, 6)
    expect(alerts[0]!.message).toContain("窗口 2026-10")
  })

  test("未超阈值不触发", () => {
    const alerts = quotaAlerts({
      budget: budget({ window_cost_usd: 10, quota_window: "month" }),
      usages: [usage("p1", 100, 0, 7.9, 0)],
      now: NOW,
    })
    expect(alerts).toEqual([])
  })

  test("跨项目分别累计：只报超阈值的那一个项目", () => {
    const alerts = quotaAlerts({
      budget: budget({ project_cost_usd: 5 }),
      usages: [usage("p1", 20, 0, 0, 0), usage("p2", 1, 0, 0, 0)],
      now: NOW,
    })
    expect(alerts).toHaveLength(1)
    expect(alerts[0]!.scope).toBe("project")
    expect(alerts[0]!.key).toBe("p1")
    expect(alerts[0]!.current).toBe(20)
  })

  test("窗口维度是所有项目在该窗口内的合计，不是逐项目重复上报", () => {
    const alerts = quotaAlerts({
      budget: budget({ window_cost_usd: 10, quota_window: "day" }),
      usages: [usage("p1", 0, 0, 6, 0), usage("p2", 0, 0, 5, 0)],
      now: NOW,
    })
    expect(alerts).toHaveLength(1)
    expect(alerts[0]!.current).toBe(11)
    expect(alerts[0]!.key).toBe("2026-10-04")
  })

  test("token 维度与 cost 维度各自独立判定", () => {
    const alerts = quotaAlerts({
      budget: budget({ project_tokens_total: 1000 }),
      usages: [usage("p1", 0, 1200, 0, 0)],
      now: NOW,
    })
    expect(alerts).toHaveLength(1)
    expect(alerts[0]!.metric).toBe("tokens")
    expect(alerts[0]!.current).toBe(1200)
  })

  test("非法额度（<=0 或非有限）视为未配置，不触发也不误报", () => {
    for (const limit of [0, -5, Number.NaN, Number.POSITIVE_INFINITY]) {
      const alerts = quotaAlerts({
        budget: budget({ project_cost_usd: limit, window_cost_usd: limit }),
        usages: [usage("p1", 999, 0, 999, 0)],
        now: NOW,
      })
      expect(alerts).toEqual([])
    }
  })

  test("超阈值（ratio >= 1）时文案改用「已超出」", () => {
    const alerts = quotaAlerts({
      budget: budget({ project_cost_usd: 5 }),
      usages: [usage("p1", 6, 0, 0, 0)],
      now: NOW,
    })
    expect(alerts[0]!.message).toContain("已超出")
  })

  test("既有单会话告警行为未回归：只配既有字段时不产生任何跨维度告警", () => {
    // token_budget 里除 alert_threshold / session_cost_usd 外没配任何跨维度额度，
    // 此时 payload 不得新增 quota_alerts 字段，单会话告警路径保持原样。
    const alerts = quotaAlerts({
      budget: budget({ alert_threshold: 0.8 }),
      usages: [usage("p1", 9999, 999999, 9999, 999999)],
      now: NOW,
    })
    expect(alerts).toEqual([])
  })
})
