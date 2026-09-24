export * as CostAdvisor from "./cost-advisor"

import { Context, Effect, Layer } from "effect"
import { SessionStore } from "./store"
import { Config } from "../config"

export interface Advice {
  readonly type: "cache_opportunity" | "model_downgrade" | "context_bloat" | "budget_alert"
  readonly severity: "info" | "warning" | "critical"
  readonly message: string
  readonly savings?: { readonly tokens?: number; readonly costUSD?: number }
}

export interface Interface {
  readonly analyze: () => Effect.Effect<Advice[]>
}

/**
 * Cache-opportunity 判定（纯函数，便于误报回归防护）：只有当缓存读占「含缓存
 * 的总输入」比例过低（<10%）且规模过 100K 才提示未充分利用。修复前 cacheRatio
 * 恒为 0，任何 >100K 输入会话都会误报——而实测稳态前缀命中可达 100%。
 */
export function cacheOpportunityAdvice(totalTokens: {
  readonly input: number
  readonly cache: { readonly read: number; readonly write: number }
}): Advice | undefined {
  const totalInput = totalTokens.input + totalTokens.cache.read + totalTokens.cache.write
  if (totalInput <= 0) return undefined
  const cacheRatio = totalTokens.cache.read / totalInput
  if (cacheRatio < 0.1 && totalInput > 100_000) {
    return {
      type: "cache_opportunity",
      severity: "info",
      message: `Total input ${totalInput.toLocaleString()} tokens but cache hit rate only ${Math.round(cacheRatio * 100)}%. Enable prompt caching (AUTO policy) to reduce repeated-context cost.`,
      savings: { tokens: Math.round(totalInput * 0.3) },
    }
  }
  return undefined
}

export class Service extends Context.Service<Service, Interface>()("@gyccode/CostAdvisor") {}

const layer = Layer.effect(
  Service,
  Effect.gen(function* () {
    const store = yield* SessionStore.Service
    const config = yield* Config.Service

    const analyze = Effect.fn("CostAdvisor.analyze")(function* () {
      const stats = yield* store.costStats()
      const configEntries = yield* config.entries()
      const budgetConfig = Config.latest(configEntries, "token_budget")
      const advice: Advice[] = []

      // 1. Cache opportunity（判定逻辑抽至 cacheOpportunityAdvice 纯函数）
      const cacheAdvice = cacheOpportunityAdvice(stats.totalTokens)
      if (cacheAdvice) advice.push(cacheAdvice)

      // 2. Model downgrade opportunity: small model heuristic disabled or expensive model for simple tasks
      const smallModelConfig = Config.latest(configEntries, "small_model_heuristic")
      if (smallModelConfig?.enabled === false) {
        advice.push({
          type: "model_downgrade",
          severity: "info",
          message: "Small model heuristic is disabled. Enable it to automatically use cheaper models for simple tasks (title generation, etc.).",
          savings: { costUSD: stats.totalCost * 0.1 },
        })
      }

      // 3. Context bloat detection: high reasoning-to-output ratio suggests wasted reasoning tokens
      if (stats.totalTokens.reasoning > stats.totalTokens.output * 3 && stats.totalTokens.reasoning > 10_000) {
        advice.push({
          type: "context_bloat",
          severity: "warning",
          message: `Reasoning tokens (${stats.totalTokens.reasoning.toLocaleString()}) are ${Math.round(stats.totalTokens.reasoning / Math.max(stats.totalTokens.output, 1))}x output tokens. Consider reducing thinking_budget_tokens or using a model with less verbose reasoning.`,
          savings: { tokens: Math.round(stats.totalTokens.reasoning * 0.5) },
        })
      }

      // 4. Budget alerts
      if (budgetConfig?.session_cost_usd !== undefined && stats.totalCost > budgetConfig.session_cost_usd * 0.8) {
        advice.push({
          type: "budget_alert",
          severity: stats.totalCost > budgetConfig.session_cost_usd ? "critical" : "warning",
          message: `Total cost $${stats.totalCost.toFixed(4)} is ${Math.round((stats.totalCost / budgetConfig.session_cost_usd) * 100)}% of session budget $${budgetConfig.session_cost_usd.toFixed(4)}.`,
        })
      }

      // 5. Per-model cost breakdown advice
      const sortedModels = Object.entries(stats.byModel).sort((a, b) => b[1].cost - a[1].cost)
      if (sortedModels.length > 1) {
        const [topModel, topStats] = sortedModels[0]!
        const avgCostPerToken = topStats.cost / Math.max(topStats.tokens, 1)
        if (avgCostPerToken > 0.0001 && topStats.tokens > 50_000) {
          advice.push({
            type: "model_downgrade",
            severity: "info",
            message: `Model ${topModel} accounts for $${topStats.cost.toFixed(4)} (${Math.round((topStats.cost / Math.max(stats.totalCost, 0.0001)) * 100)}% of total). Consider using a cheaper alternative for non-critical tasks.`,
          })
        }
      }

      return advice
    })

    return Service.of({ analyze })
  }),
)

export const node = layer
