/**
 * C-04：provider 账单适配层。本地没有统一账单可拉——各家账单 API 形态不一、
 * 多数还要额外凭据——所以这里只定义契约，让「谁提供账单」成为可插拔的一件事，
 * 而不是散落在计价逻辑里的 if。对账计算见 ./reconciliation。
 */
import { Effect } from "effect"

export type BillingEntry = {
  /** provider 侧记录的时刻（epoch 毫秒）。 */
  readonly time: number
  readonly providerID: string
  readonly modelID: string
  readonly inputTokens: number
  readonly outputTokens: number
  readonly cacheReadTokens: number
  readonly cacheWriteTokens: number
  /** provider 侧的实际扣费（美元）。 */
  readonly costUSD: number
  /**
   * 能与会话对上号的标识。优先用请求 ID；拿不到时退化为
   * `${sessionID}:${modelID}` 这类粗粒度键——对账能跑，但精度下降。
   */
  readonly key: string
}

export class BillingUnavailable extends Error {
  readonly _tag = "BillingUnavailable"
  constructor(
    readonly providerID: string,
    readonly reason: string,
  ) {
    super(`provider ${providerID} 账单不可用：${reason}`)
    this.name = "BillingUnavailable"
  }
}

/**
 * 一个 provider 的账单来源。
 *
 * `list` 返回空数组表示「确实没有账单数据」；抛 BillingUnavailable 表示
 * 「取不到」——两者语义不同，报表里必须区分，否则缺账单会被误读成已核销。
 */
export interface ProviderBilling {
  readonly providerID: string
  readonly list: (input: {
    readonly startTime: number
    readonly endTime: number
  }) => Effect.Effect<readonly BillingEntry[], BillingUnavailable>
}

const registry = new Map<string, ProviderBilling>()

export function register(billing: ProviderBilling): void {
  registry.set(billing.providerID, billing)
}

export function get(providerID: string): ProviderBilling | undefined {
  return registry.get(providerID)
}

export function registered(): readonly string[] {
  return [...registry.keys()].sort()
}

/**
 * 汇总多 provider 账单；同一个 key 出现在多个 provider 时按 providerID 前缀消歧。
 *
 * 错误通道刻意保留 `BillingUnavailable`：调用方需要区分「账单为空」与「账单取不到」。
 */
export function listAll(input: {
  readonly startTime: number
  readonly endTime: number
  readonly providerIDs?: readonly string[]
}): Effect.Effect<readonly BillingEntry[], BillingUnavailable> {
  const ids = input.providerIDs ?? registered()
  return Effect.forEach(ids, (id) => {
    const billing = registry.get(id)
    if (!billing) return Effect.succeed([] as readonly BillingEntry[])
    return billing.list({ startTime: input.startTime, endTime: input.endTime })
  }).pipe(Effect.map((groups) => groups.flat().map((entry) => ({ ...entry, key: `${entry.providerID}:${entry.key}` }))))
}