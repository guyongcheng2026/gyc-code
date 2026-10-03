import { describe, expect, it } from "bun:test"
import {
  DEFAULT_TEAMMATE_CONCURRENCY,
  MAX_TEAMMATE_CONCURRENCY,
  teammateConcurrencyLimit,
} from "./swarm"

/**
 * A-3（对标指标 16 · Agent 自主性）：swarm 此前用 `{ concurrency: "unbounded" }`
 * 起 teammate，20 个 teammate 就是 20 路并发直打 provider，会话一长就容易被限流，
 * 而且没有任何总量约束。这里锁定上限的计算规则与「非法配置回落默认」的行为。
 */

describe("teammateConcurrencyLimit", () => {
  it("默认上限保守（4），绝不是无上限", () => {
    expect(DEFAULT_TEAMMATE_CONCURRENCY).toBe(4)
    expect(DEFAULT_TEAMMATE_CONCURRENCY).toBeLessThan(MAX_TEAMMATE_CONCURRENCY)
  })

  it("未配置 / 非法值一律回落到默认", () => {
    expect(teammateConcurrencyLimit(undefined)).toBe(DEFAULT_TEAMMATE_CONCURRENCY)
    expect(teammateConcurrencyLimit(null)).toBe(DEFAULT_TEAMMATE_CONCURRENCY)
    expect(teammateConcurrencyLimit(Number.NaN)).toBe(DEFAULT_TEAMMATE_CONCURRENCY)
    expect(teammateConcurrencyLimit(Number.POSITIVE_INFINITY)).toBe(DEFAULT_TEAMMATE_CONCURRENCY)
    expect(teammateConcurrencyLimit(0)).toBe(DEFAULT_TEAMMATE_CONCURRENCY)
    expect(teammateConcurrencyLimit(-3)).toBe(DEFAULT_TEAMMATE_CONCURRENCY)
  })

  it("合法配置原样生效", () => {
    expect(teammateConcurrencyLimit(8)).toBe(8)
    expect(teammateConcurrencyLimit(1)).toBe(1)
  })

  it("超出上限的配置被夹到上限，避免配置写错把 provider 打爆", () => {
    expect(teammateConcurrencyLimit(1000)).toBe(MAX_TEAMMATE_CONCURRENCY)
  })

  it("小数向下取整，不允许出现 0 个并发", () => {
    expect(teammateConcurrencyLimit(2.9)).toBe(2)
  })
})