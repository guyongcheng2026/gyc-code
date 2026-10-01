/**
 * C-06：计价单一口径。
 *
 * 此前仓库里有两份独立计价实现：
 *  - v1 侧 `session.ts:getUsage`（Decimal 精算，按 tiers 择优 + experimentalOver200K）
 *  - core 侧 `publish-llm-event.ts:costForStep`（裸浮点，按 pickCostTier 择优）
 *  - `stats.ts` 再从消息逐条累加出第三份数字
 *
 * 两条计价路径对同一 step 会算出不同的成本（长上下文加价档、reasoning 计价方式
 * 都可能分叉），于是 `gyc stats` 的 Total Cost 与 MODEL USAGE 对不上时没人报错。
 *
 * 这里把「挑档位」和「算钱」收成一份实现，两侧都委托过来——不是各改一遍让它们
 * 碰巧一致，而是从结构上消灭第二份实现。
 */

/** 按每百万 token 计价的价格（models.dev 约定）。 */
export type Price = {
  readonly input: number
  readonly output: number
  readonly cache?: { readonly read?: number; readonly write?: number }
}

/**
 * 一条计价档位。tier 存在时表示「上下文超过 size 之后适用」——与服务商
 * 「长上下文更贵」的计费方式一致（models.dev 的 context_over_200k）。
 */
export type CostTier = Price & {
  readonly tier?: { readonly type: "context"; readonly size: number }
}

/** 计价所需的本步 token 明细。 */
export type PricingTokens = {
  readonly input: number
  readonly output: number
  readonly reasoning: number
  readonly cache: { readonly read: number; readonly write: number }
}

const safe = (value: number | undefined) => Math.max(0, Number.isFinite(value) ? (value ?? 0) : 0)

/**
 * 本步真实送进 provider 的上下文规模，用于挑选长上下文档位。
 *
 * 必须含缓存：prompt cache 的缓存命中部分仍占 provider 侧的上下文窗口，
 * 只统计未缓存的 input 会让长会话永远落在最低档位。
 */
export function contextTokensOf(tokens: PricingTokens): number {
  return safe(tokens.input) + safe(tokens.cache.read) + safe(tokens.cache.write)
}

/**
 * 按本步上下文规模挑选适用的最高档位。
 *
 * `tiers[0]` 是基准档（无 tier 字段）；带 `tier.size` 的条目在上下文**超过**
 * size 后生效。`contextTokens <= tier.size` 时不换档——边界取自 v1 侧原实现，
 * 两边必须一致，否则 C-06 的分歧会以「差一档」的形式回来。
 */
export function pickCostTier(cost: readonly CostTier[], contextTokens: number): CostTier | undefined {
  const first = cost[0]
  if (!first) return undefined
  let best = first
  for (const entry of cost.slice(1)) {
    const tier = entry?.tier
    if (!tier || tier.type !== "context") continue
    if (contextTokens <= tier.size) continue
    const bestSize = best.tier?.type === "context" ? best.tier.size : 0
    if (tier.size >= bestSize) best = entry
  }
  return best
}

/**
 * 单价档位的选取：tiers 优先，否则回退 experimentalOver200K / 基准价。
 * 返回 undefined 表示该模型没有价格数据（cost 为 0 ≠ 免费，见 stats.unpricedModels）。
 */
export function resolvePrice(
  cost: (Price & {
    readonly tiers?: readonly CostTier[]
    readonly experimentalOver200K?: Price
  }) | undefined,
  contextTokens: number,
): Price | undefined {
  if (!cost) return undefined
  if (cost.tiers && cost.tiers.length > 0) {
    const picked = pickCostTier(cost.tiers, contextTokens)
    if (picked) return picked
  }
  if (cost.experimentalOver200K && contextTokens > 200_000) return cost.experimentalOver200K
  // 只取价格字段：cost 上还挂着 tiers / experimentalOver200K，直接透传会让下游
  // 拿到一个「看起来是 Price 其实不是」的对象（字段比对、序列化都会露馅）。
  return { input: cost.input, output: cost.output, cache: cost.cache }
}

/**
 * 计价：token 数 × 每百万单价。
 *
 * reasoning 按 output 单价计——与 v1 侧 getUsage 原注释一致
 * （models.dev 计价模型未细分 reasoning 前，不按 input 单价算）。
 * 精度用 Decimal 之外的双精度累加：单价本身来自 models.dev 的近似值，
 * 这里的误差量级远小于单价本身的误差；但**档位选取**才是真正会导致分歧的地方。
 */
export function priceTokens(tokens: PricingTokens, price: Price | undefined): number {
  if (!price) return 0
  const charge = (count: number, perMillion: number) => (safe(count) * safe(perMillion)) / 1_000_000
  return (
    charge(tokens.input, price.input) +
    charge(tokens.output, price.output) +
    charge(tokens.reasoning, price.output) +
    charge(tokens.cache.read, price.cache?.read ?? 0) +
    charge(tokens.cache.write, price.cache?.write ?? 0)
  )
}

/**
 * 一步 provider 调用的成本：先按上下文规模选档，再计价。
 * 这是 core 侧与 v1 侧共同入口。
 */
export function costForStep(
  tokens: PricingTokens,
  price: Price | readonly CostTier[] | undefined,
): number {
  if (!price) return 0
  const resolved: Price | undefined = Array.isArray(price)
    ? pickCostTier(price as readonly CostTier[], contextTokensOf(tokens))
    : (price as Price)
  return priceTokens(tokens, resolved)
}
