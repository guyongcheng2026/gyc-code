import { describe, expect, test } from "bun:test"
import { RECONNECT_POLICY, nextReconnect, shouldReconnect } from "./reconnect"

describe("MCP 断连重连退避", () => {
  test("等待时间按倍率递增，首轮为 initialDelay", () => {
    expect(nextReconnect(0).delay).toBe(RECONNECT_POLICY.initialDelay)
    expect(nextReconnect(1).delay).toBe(RECONNECT_POLICY.initialDelay * RECONNECT_POLICY.factor)
    expect(nextReconnect(2).delay).toBe(RECONNECT_POLICY.initialDelay * RECONNECT_POLICY.factor ** 2)
  })

  test("attempt 从 1 开始计数", () => {
    expect(nextReconnect(0).attempt).toBe(1)
    expect(nextReconnect(7).attempt).toBe(8)
  })

  test("等待时间不超过 maxDelay，避免打死服务器", () => {
    for (let attempt = 0; attempt < 30; attempt++) {
      const plan = nextReconnect(attempt)
      if (plan.exhausted) continue
      expect(plan.delay!).toBeLessThanOrEqual(RECONNECT_POLICY.maxDelay)
    }
    expect(nextReconnect(RECONNECT_POLICY.maxAttempts - 1).delay).toBe(RECONNECT_POLICY.maxDelay)
  })

  test("达到 maxAttempts 后不再排程，不会无限重连", () => {
    expect(nextReconnect(RECONNECT_POLICY.maxAttempts).exhausted).toBe(true)
    expect(nextReconnect(RECONNECT_POLICY.maxAttempts + 5).exhausted).toBe(true)
    expect(nextReconnect(RECONNECT_POLICY.maxAttempts - 1).exhausted).toBe(false)
  })

  test("完整退避序列：单调不降、总量有界", () => {
    const delays: number[] = []
    let attempt = 0
    while (true) {
      const plan = nextReconnect(attempt)
      if (plan.exhausted) break
      delays.push(plan.delay!)
      attempt = plan.attempt!
    }
    expect(delays.length).toBe(RECONNECT_POLICY.maxAttempts)
    for (let i = 1; i < delays.length; i++) expect(delays[i]!).toBeGreaterThanOrEqual(delays[i - 1]!)
    expect(delays[delays.length - 1]).toBe(RECONNECT_POLICY.maxDelay)
  })

  test("支持自定义策略", () => {
    const plan = nextReconnect(0, { initialDelay: 10, factor: 3, maxDelay: 25, maxAttempts: 2 })
    expect(plan.delay).toBe(10)
    expect(nextReconnect(1, { initialDelay: 10, factor: 3, maxDelay: 25, maxAttempts: 2 }).delay).toBe(25)
    expect(nextReconnect(2, { initialDelay: 10, factor: 3, maxDelay: 25, maxAttempts: 2 }).exhausted).toBe(true)
  })
})

describe("MCP 断连重连开关判断", () => {
  test("意外断连（failed）时允许重连", () => {
    expect(shouldReconnect({ disposed: false, status: "failed", enabled: true })).toBe(true)
    expect(shouldReconnect({ disposed: false, status: undefined, enabled: true })).toBe(true)
  })

  test("实例已释放后不再重连（游离 fiber 兜底）", () => {
    expect(shouldReconnect({ disposed: true, status: "failed", enabled: true })).toBe(false)
  })

  test("配置里被禁用的 server 不重连", () => {
    expect(shouldReconnect({ disposed: false, status: "failed", enabled: false })).toBe(false)
  })

  test("用户主动 disconnect（disabled）不重连", () => {
    expect(shouldReconnect({ disposed: false, status: "disabled", enabled: true })).toBe(false)
  })

  test("需要人工认证的终态不重连，避免空转", () => {
    expect(shouldReconnect({ disposed: false, status: "needs_auth", enabled: true })).toBe(false)
    expect(shouldReconnect({ disposed: false, status: "needs_client_registration", enabled: true })).toBe(false)
    expect(shouldReconnect({ disposed: false, status: "connected", enabled: true })).toBe(false)
  })
})
