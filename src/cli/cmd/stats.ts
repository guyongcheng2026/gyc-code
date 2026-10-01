import { Effect } from "effect"
import { effectCmd } from "../effect-cmd"
import { Session } from "@/session/session"
import { NotFoundError } from "@/storage/storage"
import { Database } from "@gyccode/core/database/database"
import { SessionTable } from "@gyccode/core/session/sql"
import { promptCacheStats, type CacheRowLike } from "@gyccode/core/session/cache-rate"
import { Project } from "@/project/project"
import { InstanceRef } from "@/effect/instance-ref"
import { Provider } from "@/provider/provider"
import { ProviderV2 } from "@gyccode/core/provider"
import { ModelV2 } from "@gyccode/core/model"
import { listAll, registered } from "@/billing/provider-billing"
import type { BillingEntry } from "@/billing/provider-billing"
import { formatReport, reconcile } from "@/billing/reconciliation"

interface SessionStats {
  totalSessions: number
  totalMessages: number
  totalCost: number
  totalTokens: {
    input: number
    output: number
    reasoning: number
    cache: {
      read: number
      write: number
    }
  }
  toolUsage: Record<string, number>
  /** 2026-09-30（每任务成本 P0）：cost 为 0 是因为没查到价，而非真免费的模型。 */
  unpricedModels: Array<{ model: string; sessions: number }>
  modelUsage: Record<
    string,
    {
      messages: number
      tokens: {
        input: number
        output: number
        cache: {
          read: number
          write: number
        }
      }
      cost: number
    }
  >
  dateRange: {
    earliest: number
    latest: number
  }
  days: number
  costPerDay: number
  tokensPerSession: number
  medianTokensPerSession: number
  /** 2026-09-30（每任务成本 P2 / C-08）：压缩产生的开销单列，可与 totalCost 对账。 */
  compactionCost: number
  /**
   * 2026-09-30（每任务成本 P1 / C-07）：真实 prompt 缓存命中率。原先 stats 只
   * 输出 Cache Read 的绝对值，看不出「本可命中却没命中」——命中率只在
   * `gyc db cache` 里，口径还与 UI 前端重算的那套不同。此处复用 db.ts 的
   * promptCacheStats，保证与 `gyc db cache` 同一把尺子。
   */
  cacheHitRate: {
    /** 前缀命中率：Σ min(本轮命中, 上轮总输入) / Σ 上轮总输入 */
    prefix: number
    /** 稳态命中率：剔除字节漂移事件行后的同式，衡量稳态健康度 */
    steady: number
    /** 参与统计的配对轮次数，0 表示样本不足（比率无意义） */
    pairs: number
  }
  /**
   * 2026-09-30（C-06）：三套成本口径的对账结果。`totalCost` 取自 `session.cost`
   * （投影侧权威值），`modelUsage` 逐 message 累加得到第二份，两者本应相等。
   * 差额超阈值说明某条计价路径漏了或重复了 —— 此前无人比对，对不上也没人知道。
   */
  costReconciliation: {
    /** 会话口径总成本 */
    fromSessions: number
    /** 逐 message 累加口径总成本 */
    fromMessages: number
    /** fromSessions - fromMessages */
    drift: number
    /** drift 占 fromSessions 的比例，超过 1% 即视为口径分歧 */
    driftRatio: number
    /** 是否已越过阈值（需人工介入） */
    mismatched: boolean
  }
}

/**
 * 找出「被会话用到、但 Provider 侧查不到真实单价」的模型。
 *
 * 存在的理由：自建/自研端点走 provider.ts 的动态发现分支，OpenAI 兼容的 /models
 * 一般不返回价格字段，cost 三级 ?? 0 兜底后恒为 0。不点名的话，谷总看到
 * session.cost=0 会读成「不花钱」——而这恰恰是最该知道有没有在烧钱的场景。
 *
 * 刻意只认 priced === false：模型在目录里查不到（getModel 失败）时返回 undefined，
 * 那属于「模型已下线/被重命名」，不是「静默按 0 计费」，不混进同一类告警。
 */
export function detectUnpricedModels<R>(
  modelKeys: readonly string[],
  lookup: (providerID: string, modelID: string) => Effect.Effect<{ priced?: boolean } | undefined, never, R>,
): Effect.Effect<Array<{ model: string; sessions: number }>, never, R> {
  return Effect.gen(function* () {
    const perModel = new Map<string, number>()
    for (const key of modelKeys) {
      perModel.set(key, (perModel.get(key) ?? 0) + 1)
    }
    const out: Array<{ model: string; sessions: number }> = []
    for (const [key, count] of perModel) {
      const slash = key.indexOf("/")
      const model = yield* lookup(key.slice(0, slash), key.slice(slash + 1))
      if (model?.priced === false) {
        out.push({ model: key, sessions: count })
      }
    }
    out.sort((a, b) => b.sessions - a.sessions)
    return out
  })
}

/**
 * 2026-09-30（C-06）：成本口径对账。阈值取 1% —— 浮点累加误差远小于此，
 * 越过即代表两条计价路径真的分叉了，而非舍入噪声。
 *
 * 导出以便测试直接锁定判定逻辑。
 */
export function reconcileCost(
  fromSessions: number,
  modelUsage: Record<string, { cost: number }>,
): SessionStats["costReconciliation"] {
  const fromMessages = Object.values(modelUsage).reduce((sum, m) => sum + m.cost, 0)
  const drift = fromSessions - fromMessages
  const driftRatio = fromSessions === 0 ? 0 : Math.abs(drift) / Math.abs(fromSessions)
  return {
    fromSessions,
    fromMessages,
    drift,
    driftRatio,
    mismatched: driftRatio > 0.01,
  }
}

export const StatsCommand = effectCmd({
  command: "stats",
  describe: "显示 token 用量与成本统计",
  builder: (yargs) =>
    yargs
      .option("days", {
        describe: "显示最近 N 天的统计（默认：全部时间）",
        type: "number",
      })
      .option("tools", {
        describe: "要显示的工具数量（默认：全部）",
        type: "number",
      })
      .option("models", {
        describe: "显示模型统计（默认：隐藏）。传入数字则显示前 N 项，否则显示全部",
      })
      .option("project", {
        describe: "按项目筛选（默认：所有项目，空字符串：当前项目）",
        type: "string",
      })
      // C-04：把本地估算与 provider 账单摆到同一张表上。缺账单与超阈值是两件事，
      // 前者是「还没核销」，后者是「核销失败」，混在一起就等于没对账。
      .option("reconcile", {
        describe: "输出与 provider 账单的对账报表（默认：关闭；无可用账单来源时只报本地侧）",
        type: "boolean",
      })
      .option("reconcile-limit", {
        describe: "对账报表最多显示多少行（默认：50）",
        type: "number",
      }),
  handler: Effect.fn("Cli.stats")(function* (args) {
    const ctx = yield* InstanceRef
    if (!ctx) return
    const stats = yield* aggregateSessionStats(args.days, args.project, ctx.project)
    if (args.reconcile) {
      const report = yield* reconcileLocal(stats, args.days)
      console.log(formatReport(report, args["reconcile-limit"] ?? 50))
      return
    }
    let modelLimit: number | undefined
    if (args.models === true) {
      modelLimit = Infinity
    } else if (typeof args.models === "number") {
      modelLimit = args.models
    }
    displayStats(stats, args.tools, modelLimit)
  }),
})

/**
 * C-04：从 stats 聚合出的会话成本作为本地侧，与已注册的 provider 账单源对账。
 * 没有注册任何账单来源时返回空 provider 侧——报表会如实显示全部为「缺账单」，
 * 而不是静默输出「已核销」。
 */
const reconcileLocal = Effect.fnUntraced(function* (stats: SessionStats, days: number | undefined) {
  const local = Object.entries(stats.modelUsage ?? {}).map(([key, value]) => ({
    key,
    amount: value.cost,
  }))
  const MS_IN_DAY = 24 * 60 * 60 * 1000
  const endTime = Date.now()
  const startTime = days === undefined ? 0 : endTime - days * MS_IN_DAY
  const entries =
    registered().length === 0
      ? []
      : yield* listAll({ startTime, endTime }).pipe(
          // C-04：账单源不可用（缺凭据 / provider 侧报错）不能让 stats 整体失败——
          // 对账是观测手段，取不到就退化成「本地侧单边报表」。
          Effect.catch((error) =>
            Effect.logWarning("provider 账单拉取失败，对账退化为本地侧", { error }).pipe(
              Effect.as([] as readonly BillingEntry[]),
            ),
          ),
        )
  const provider = entries.map((entry) => ({ key: entry.key, amount: entry.costUSD }))
  return reconcile(local, provider)
})

const getAllSessions = Effect.fnUntraced(function* () {
  const { db } = yield* Database.Service
  return (yield* db.select().from(SessionTable).all().pipe(Effect.orDie)).map((row) => Session.fromRow(row))
})

const aggregateSessionStats = Effect.fn("Cli.stats.aggregate")(function* (
  days?: number,
  projectFilter?: string,
  currentProject?: Project.Info,
) {
  const svc = yield* Session.Service
  const sessions = yield* getAllSessions()
  const MS_IN_DAY = 24 * 60 * 60 * 1000

  const cutoffTime = (() => {
    if (days === undefined) return 0
    if (days === 0) {
      const now = new Date()
      now.setHours(0, 0, 0, 0)
      return now.getTime()
    }
    return Date.now() - days * MS_IN_DAY
  })()

  const windowDays = (() => {
    if (days === undefined) return
    if (days === 0) return 1
    return days
  })()

  let filteredSessions = cutoffTime > 0 ? sessions.filter((session) => session.time.updated >= cutoffTime) : sessions

  if (projectFilter !== undefined) {
    if (projectFilter === "") {
      if (!currentProject) throw new Error("当 projectFilter 为空字符串时必须提供 currentProject")
      filteredSessions = filteredSessions.filter((session) => session.projectID === currentProject.id)
    } else {
      filteredSessions = filteredSessions.filter((session) => session.projectID === projectFilter)
    }
  }

  // 2026-09-30（每任务成本 P0）：子代理用量已由 projector.rollupUsage 逐级上卷到
  // 祖先，父会话的 cost 含整棵子树。若下面对全部会话求和，父子各算一遍会翻倍。
  // 只统计根会话（无父，或父不在结果集中 —— 后者含被时间窗滤掉的父与已删父）。
  {
    const ids = new Set(filteredSessions.map((s) => s.id))
    filteredSessions = filteredSessions.filter((s) => s.parentID === undefined || !ids.has(s.parentID))
  }

  const stats: SessionStats = {
    totalSessions: filteredSessions.length,
    totalMessages: 0,
    totalCost: 0,
    totalTokens: {
      input: 0,
      output: 0,
      reasoning: 0,
      cache: {
        read: 0,
        write: 0,
      },
    },
    toolUsage: {},
    unpricedModels: [],
    modelUsage: {},
    dateRange: {
      earliest: Date.now(),
      latest: Date.now(),
    },
    days: 0,
    costPerDay: 0,
    tokensPerSession: 0,
    medianTokensPerSession: 0,
    compactionCost: 0,
    cacheHitRate: { prefix: 0, steady: 0, pairs: 0 },
    costReconciliation: { fromSessions: 0, fromMessages: 0, drift: 0, driftRatio: 0, mismatched: false },
  }

  if (filteredSessions.length > 1000) {
    console.log(`Large dataset detected (${filteredSessions.length} sessions). This may take a while...`)
  }

  if (filteredSessions.length === 0) {
    stats.days = windowDays ?? 0
    return stats
  }

  let earliestTime = Date.now()
  let latestTime = 0

  const sessionTotalTokens: number[] = []
  // C-07：逐轮 token 快照，供 core/session/cache-rate 的 promptCacheStats 按同一口径
  // 算命中率，避免 stats 与 `gyc db cache` 各算各的。这里需要可 push 的可变数组，
  // 故用 CacheRowLike[] 而非 promptCacheStats 参数的 readonly 类型。
  const allCacheRows: CacheRowLike[] = []

  const results = yield* Effect.forEach(
    filteredSessions,
    (session) =>
      Effect.gen(function* () {
        const messages = yield* svc
          .messages({ sessionID: session.id })
          .pipe(Effect.catchIf(NotFoundError.isInstance, () => Effect.succeed([])))

        const sessionCost = session.cost ?? 0
        const sessionTokens = session.tokens ?? { input: 0, output: 0, reasoning: 0, cache: { read: 0, write: 0 } }
        let sessionToolUsage: Record<string, number> = {}
        let sessionModelUsage: Record<
          string,
          {
            messages: number
            tokens: { input: number; output: number; cache: { read: number; write: number } }
            cost: number
          }
        > = {}
        const rows: CacheRowLike[] = []
        let compactionCost = 0

        for (const message of messages) {
          if (message.info.role === "assistant") {
            const modelKey = `${message.info.providerID}/${message.info.modelID}`
            if (message.info.tokens) {
              // promptCacheStats 读的是数据库里的 JSON 文本列，因此这里同样以
              // JSON 字符串喂入，否则每行都会在解析处被跳过、命中率恒为 0。
              rows.push({
                time_created: message.info.time?.completed ?? message.info.time?.created ?? 0,
                data: JSON.stringify({
                  sessionID: session.id,
                  tokens: {
                    input: message.info.tokens.input ?? 0,
                    cache: {
                      read: message.info.tokens.cache?.read ?? 0,
                      write: message.info.tokens.cache?.write ?? 0,
                    },
                  },
                }),
              } as unknown as Parameters<typeof promptCacheStats>[0][number])
            }
            if (!sessionModelUsage[modelKey]) {
              sessionModelUsage[modelKey] = {
                messages: 0,
                tokens: { input: 0, output: 0, cache: { read: 0, write: 0 } },
                cost: 0,
              }
            }
            sessionModelUsage[modelKey].messages++
            sessionModelUsage[modelKey].cost += message.info.cost || 0
            // C-08：压缩本身要花钱，但它不是「任务产出」。原先混在总量里，
            // 压缩策略改动会让成本曲线出现无法解释的跳变。
            if ((message.info as { mode?: string }).mode === "compaction") {
              compactionCost += message.info.cost || 0
            }

            if (message.info.tokens) {
              sessionModelUsage[modelKey].tokens.input += message.info.tokens.input || 0
              sessionModelUsage[modelKey].tokens.output +=
                (message.info.tokens.output || 0) + (message.info.tokens.reasoning || 0)
              sessionModelUsage[modelKey].tokens.cache.read += message.info.tokens.cache?.read || 0
              sessionModelUsage[modelKey].tokens.cache.write += message.info.tokens.cache?.write || 0
            }
          }

          for (const part of message.parts) {
            if (part.type === "tool" && part.tool) {
              sessionToolUsage[part.tool] = (sessionToolUsage[part.tool] || 0) + 1
            }
          }
        }

        return {
          messageCount: messages.length,
          sessionCost,
          sessionTokens,
          sessionTotalTokens:
            sessionTokens.input +
            sessionTokens.output +
            sessionTokens.reasoning +
            sessionTokens.cache.read +
            sessionTokens.cache.write,
          sessionToolUsage,
          sessionModelUsage,
          compactionCost,
          cacheRows: rows,
          modelKey: `${session.model?.providerID ?? "unknown"}/${session.model?.id ?? "unknown"}`,
          earliestTime: cutoffTime > 0 ? session.time.updated : session.time.created,
          latestTime: session.time.updated,
        }
      }),
    { concurrency: 20 },
  )

  for (const result of results) {
    earliestTime = Math.min(earliestTime, result.earliestTime)
    latestTime = Math.max(latestTime, result.latestTime)
    sessionTotalTokens.push(result.sessionTotalTokens)
    allCacheRows.push(...result.cacheRows)
    // C-08：压缩开销单列（可与总量对账 = totalCost - compactionCost）
    stats.compactionCost += result.compactionCost

    stats.totalMessages += result.messageCount
    stats.totalCost += result.sessionCost
    stats.totalTokens.input += result.sessionTokens.input
    stats.totalTokens.output += result.sessionTokens.output
    stats.totalTokens.reasoning += result.sessionTokens.reasoning
    stats.totalTokens.cache.read += result.sessionTokens.cache.read
    stats.totalTokens.cache.write += result.sessionTokens.cache.write

    for (const [tool, count] of Object.entries(result.sessionToolUsage)) {
      stats.toolUsage[tool] = (stats.toolUsage[tool] || 0) + count
    }

    for (const [model, usage] of Object.entries(result.sessionModelUsage)) {
      if (!stats.modelUsage[model]) {
        stats.modelUsage[model] = {
          messages: 0,
          tokens: { input: 0, output: 0, cache: { read: 0, write: 0 } },
          cost: 0,
        }
      }
      stats.modelUsage[model].messages += usage.messages
      stats.modelUsage[model].tokens.input += usage.tokens.input
      stats.modelUsage[model].tokens.output += usage.tokens.output
      stats.modelUsage[model].tokens.cache.read += usage.tokens.cache.read
      stats.modelUsage[model].tokens.cache.write += usage.tokens.cache.write
      stats.modelUsage[model].cost += usage.cost
    }
  }

  const rangeDays = Math.max(1, Math.ceil((latestTime - earliestTime) / MS_IN_DAY))
  const effectiveDays = windowDays ?? rangeDays

  // 2026-09-30（每任务成本 P0）：标出「cost 为 0 是因为没查到价」的模型。
  // 判定依据是 Provider.Model.priced（provider.ts:1289,1565）：models.dev 目录有该
  // 条目、或配置里显式给了 cost，才算有真实单价；自建端点走动态发现时 priced=false。
  stats.unpricedModels = yield* detectUnpricedModels(
    results.map((r) => r.modelKey),
    (providerID, modelID) =>
      Provider.Service.pipe(
        Effect.flatMap((p) => p.getModel(ProviderV2.ID.make(providerID), ModelV2.ID.make(modelID))),
        Effect.catch(() => Effect.succeed(undefined)),
      ),
  )

  stats.dateRange = {
    earliest: earliestTime,
    latest: latestTime,
  }
  stats.days = effectiveDays
  stats.costPerDay = stats.totalCost / effectiveDays
  const totalTokens =
    stats.totalTokens.input +
    stats.totalTokens.output +
    stats.totalTokens.reasoning +
    stats.totalTokens.cache.read +
    stats.totalTokens.cache.write
  stats.tokensPerSession = filteredSessions.length > 0 ? totalTokens / filteredSessions.length : 0
  sessionTotalTokens.sort((a, b) => a - b)
  const mid = Math.floor(sessionTotalTokens.length / 2)
  stats.medianTokensPerSession =
    sessionTotalTokens.length === 0
      ? 0
      : sessionTotalTokens.length % 2 === 0
        ? ((sessionTotalTokens[mid - 1] ?? 0) + (sessionTotalTokens[mid] ?? 0)) / 2
        : (sessionTotalTokens[mid] ?? 0)

  // C-07：复用 db.ts 的口径，保证 stats 与 `gyc db cache` 报的是同一把尺子
  const cache = promptCacheStats(allCacheRows)
  stats.cacheHitRate = {
    prefix: cache.prefixBase > 0 ? cache.prefixHit / cache.prefixBase : 0,
    steady: cache.steadyBase > 0 ? cache.steadyHit / cache.steadyBase : 0,
    pairs: allCacheRows.length,
  }

  // C-06：把两条口径摆到同一张表上对比。totalCost 走 session.cost，
  // modelUsage 走逐 message 累加 —— 二者同源则 drift≈0；出现 drift 说明
  // 有消息没被投影计价、或计价被重复应用，此前这种分歧完全不可见。
  stats.costReconciliation = reconcileCost(stats.totalCost, stats.modelUsage)

  return stats
})

export function displayStats(stats: SessionStats, toolLimit?: number, modelLimit?: number) {
  const width = 56

  function renderRow(label: string, value: string): string {
    const availableWidth = width - 1
    const paddingNeeded = availableWidth - label.length - value.length
    const padding = Math.max(0, paddingNeeded)
    return `│${label}${" ".repeat(padding)}${value} │`
  }

  // Overview section
  console.log("┌────────────────────────────────────────────────────────┐")
  console.log("│                       OVERVIEW                         │")
  console.log("├────────────────────────────────────────────────────────┤")
  console.log(renderRow("Sessions", stats.totalSessions.toLocaleString()))
  console.log(renderRow("Messages", stats.totalMessages.toLocaleString()))
  console.log(renderRow("Days", stats.days.toString()))
  console.log("└────────────────────────────────────────────────────────┘")
  console.log()

  // Cost & Tokens section
  console.log("┌────────────────────────────────────────────────────────┐")
  console.log("│                    COST & TOKENS                       │")
  console.log("├────────────────────────────────────────────────────────┤")
  const cost = isNaN(stats.totalCost) ? 0 : stats.totalCost
  const costPerDay = isNaN(stats.costPerDay) ? 0 : stats.costPerDay
  const tokensPerSession = isNaN(stats.tokensPerSession) ? 0 : stats.tokensPerSession
  console.log(renderRow("Total Cost", `$${cost.toFixed(2)}`))
  console.log(renderRow("Avg Cost/Day", `$${costPerDay.toFixed(2)}`))
  console.log(renderRow("Avg Tokens/Session", formatNumber(Math.round(tokensPerSession))))
  const medianTokensPerSession = isNaN(stats.medianTokensPerSession) ? 0 : stats.medianTokensPerSession
  console.log(renderRow("Median Tokens/Session", formatNumber(Math.round(medianTokensPerSession))))
  console.log(renderRow("Input", formatNumber(stats.totalTokens.input)))
  console.log(renderRow("Output", formatNumber(stats.totalTokens.output)))
  console.log(renderRow("Cache Read", formatNumber(stats.totalTokens.cache.read)))
  console.log(renderRow("Cache Write", formatNumber(stats.totalTokens.cache.write)))
  // C-07：绝对值看不出「本可命中却没命中」，命中率此前只在 `gyc db cache` 里，
  // 且与 UI 前端重算的那套口径不同。样本不足时如实说明而不是显示 0%。
  const rate = stats.cacheHitRate
  const pct = (value: number) => (rate.pairs === 0 ? "样本不足" : `${(value * 100).toFixed(1)}%`)
  console.log(renderRow("Cache Hit Rate (prefix)", pct(rate.prefix)))
  console.log(renderRow("Cache Hit Rate (steady)", pct(rate.steady)))
  // C-08：压缩开销单列。压缩策略调整会让它明显波动，混在总量里就成了「说不清的成本」
  if (stats.compactionCost > 0) {
    const share = cost > 0 ? (stats.compactionCost / cost) * 100 : 0
    console.log(renderRow("  of which compaction", `$${stats.compactionCost.toFixed(4)} (${share.toFixed(1)}%)`))
  }
  console.log("└────────────────────────────────────────────────────────┘")
  // C-06：Total Cost 走 session.cost，MODEL USAGE 逐 message 累加得到第二份。
  // 二者对不上说明有计价路径漏了或重复了 —— 只在超阈值时才提示，正常情况不刷屏。
  if (stats.costReconciliation.mismatched) {
    console.log()
    console.log("⚠ 成本口径对账不一致：")
    console.log(`    会话口径   $${stats.costReconciliation.fromSessions.toFixed(4)}`)
    console.log(`    逐轮口径   $${stats.costReconciliation.fromMessages.toFixed(4)}`)
    console.log(`    差额       $${stats.costReconciliation.drift.toFixed(4)} (${(stats.costReconciliation.driftRatio * 100).toFixed(1)}%)`)
    console.log("    通常意味着有消息未被投影计价，或计价被重复应用；请提交 issue 并附上本输出。")
  }
  // 2026-09-30（每任务成本 P0）：自建/自研端点走 provider.ts 的动态发现分支，
  // 而 OpenAI 兼容的 /models 一般不返回价格字段，三级 ?? 0 兜底后 session.cost
  // 恒为 0。若不提示，谷总会把「没查到价」读成「不花钱」——而这恰恰是最需要
  // 知道自己有没有在烧钱的场景。
  if (stats.unpricedModels.length > 0) {
    console.log()
    console.log(
      `⚠ ${stats.unpricedModels.length} 个模型无单价数据，以下成本按 0 计，不代表免费：`,
    )
    for (const entry of stats.unpricedModels.slice(0, 10)) {
      console.log(`    ${entry.model}  (${formatNumber(entry.sessions)} 个会话)`)
    }
    if (stats.unpricedModels.length > 10) {
      console.log(`    …另有 ${stats.unpricedModels.length - 10} 个`)
    }
    console.log("    在配置的 provider.<id>.models.<model>.cost 中填入单价即可参与统计。")
  }
  console.log()

  // Model Usage section
  if (modelLimit !== undefined && Object.keys(stats.modelUsage).length > 0) {
    const sortedModels = Object.entries(stats.modelUsage).sort(([, a], [, b]) => b.messages - a.messages)
    const modelsToDisplay = modelLimit === Infinity ? sortedModels : sortedModels.slice(0, modelLimit)

    console.log("┌────────────────────────────────────────────────────────┐")
    console.log("│                      MODEL USAGE                       │")
    console.log("├────────────────────────────────────────────────────────┤")

    for (const [model, usage] of modelsToDisplay) {
      console.log(`│ ${model.padEnd(54)} │`)
      console.log(renderRow("  Messages", usage.messages.toLocaleString()))
      console.log(renderRow("  Input Tokens", formatNumber(usage.tokens.input)))
      console.log(renderRow("  Output Tokens", formatNumber(usage.tokens.output)))
      console.log(renderRow("  Cache Read", formatNumber(usage.tokens.cache.read)))
      console.log(renderRow("  Cache Write", formatNumber(usage.tokens.cache.write)))
      console.log(renderRow("  Cost", `$${usage.cost.toFixed(4)}`))
      console.log("├────────────────────────────────────────────────────────┤")
    }
    // Remove last separator and add bottom border
    process.stdout.write("\x1B[1A") // Move up one line
    console.log("└────────────────────────────────────────────────────────┘")
  }
  console.log()

  // Tool Usage section
  if (Object.keys(stats.toolUsage).length > 0) {
    const sortedTools = Object.entries(stats.toolUsage).sort(([, a], [, b]) => b - a)
    const toolsToDisplay = toolLimit ? sortedTools.slice(0, toolLimit) : sortedTools

    console.log("┌────────────────────────────────────────────────────────┐")
    console.log("│                      TOOL USAGE                        │")
    console.log("├────────────────────────────────────────────────────────┤")

    const maxCount = Math.max(...toolsToDisplay.map(([, count]) => count))
    const totalToolUsage = Object.values(stats.toolUsage).reduce((a, b) => a + b, 0)

    for (const [tool, count] of toolsToDisplay) {
      const barLength = Math.max(1, Math.floor((count / maxCount) * 20))
      const bar = "█".repeat(barLength)
      const percentage = ((count / totalToolUsage) * 100).toFixed(1)

      const maxToolLength = 18
      const truncatedTool = tool.length > maxToolLength ? tool.substring(0, maxToolLength - 2) + ".." : tool
      const toolName = truncatedTool.padEnd(maxToolLength)

      const content = ` ${toolName} ${bar.padEnd(20)} ${count.toString().padStart(3)} (${percentage.padStart(4)}%)`
      const padding = Math.max(0, width - content.length - 1)
      console.log(`│${content}${" ".repeat(padding)} │`)
    }
    console.log("└────────────────────────────────────────────────────────┘")
  }
  console.log()
}

function formatNumber(num: number): string {
  if (num >= 1000000) {
    return (num / 1000000).toFixed(1) + "M"
  } else if (num >= 1000) {
    return (num / 1000).toFixed(1) + "K"
  }
  return num.toString()
}
