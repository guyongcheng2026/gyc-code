/**
 * P1-5「MCP 断连重连」的纯逻辑部分。
 *
 * 这里只放可单测的退避计算与开关判断，真正的重连编排在
 * `mcp/index.ts` 的 `watch()` 中：断连后按本模块给出的退避序列
 * 重新走一遍 `createAndStore`，因此对 stdio / streamable-http /
 * sse / ws 四种已接入的传输一视同仁。
 */

/** 断连重连的退避策略 */
export interface ReconnectPolicy {
  /** 首轮重连前的等待时间（毫秒） */
  readonly initialDelay: number
  /** 退避倍率 */
  readonly factor: number
  /** 单次等待上限（毫秒），防止把远端服务器打死 */
  readonly maxDelay: number
  /** 最大重连次数，超过后放弃，等待用户手动恢复 */
  readonly maxAttempts: number
}

export const RECONNECT_POLICY: ReconnectPolicy = {
  initialDelay: 1_000,
  factor: 2,
  maxDelay: 60_000,
  maxAttempts: 10,
}

export interface ReconnectPlan {
  /** 本次是第几次重连（从 1 开始）；已用尽时保持传入值 */
  readonly attempt: number
  /** 本次重连前的等待毫秒数；`exhausted` 为 true 时没有该值 */
  readonly delay?: number
  /** 重连次数是否已用尽 */
  readonly exhausted: boolean
}

/**
 * 计算第 `attempt` 次（0 基）断连后应当等待多久再重连。
 * 等待时间指数增长并被 `maxDelay` 封顶，次数耗尽后返回 `exhausted`，
 * 调用方据此停止重连。
 */
export function nextReconnect(attempt: number, policy: ReconnectPolicy = RECONNECT_POLICY): ReconnectPlan {
  if (attempt >= policy.maxAttempts) return { attempt, exhausted: true }
  const raw = policy.initialDelay * Math.pow(policy.factor, attempt)
  return {
    attempt: attempt + 1,
    delay: Math.min(Math.round(raw), policy.maxDelay),
    exhausted: false,
  }
}

/** 可以判定为「不再重连」的 server 终态 */
const TERMINAL_STATUS = new Set(["connected", "disabled", "needs_auth", "needs_client_registration"])

/**
 * 判断这次断连是否还应该重连。
 *
 * - `disposed`：实例 finalizer 已执行。`EffectBridge.fork` 出来的是游离
 *   fiber，不会随作用域中断，只能靠这个标志兜底。
 * - `status`：`disabled` 是用户主动断开，`needs_auth` /
 *   `needs_client_registration` 需要人工介入，重连没有意义。
 * - `enabled`：配置里被显式关掉的 server 不重连。
 */
export function shouldReconnect(input: {
  disposed: boolean
  status: string | undefined
  enabled: boolean | undefined
}): boolean {
  if (input.disposed) return false
  if (input.enabled === false) return false
  if (input.status !== undefined && TERMINAL_STATUS.has(input.status)) return false
  return true
}

export * as McpReconnect from "./reconnect"
