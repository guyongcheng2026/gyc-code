/**
 * C-04：成本对账。计价本身在 session.ts:getUsage（C-01/C-05 补齐了来源标注与
 * append-only 流水），但**记账和核销是两件事**：本地按 models.dev 单价估出来的
 * 数字，永远没法回答「这个月账单是 $x，我记的是 $y，差额 $z 从哪来」。
 *
 * 这里提供纯计算的对账内核：输入两侧的数字，输出逐行差异与汇总报表。不碰网络、
 * 不读数据库，因此可以被 CLI、测试、以及将来的 provider 适配器共用。
 *
 * 阈值默认 1% —— 浮点累加误差远小于此，越过即代表两条计价路径真的分叉了。
 */

/** 单行对账结果：一侧是会话口径，另一侧是 provider 账单口径。 */
export type ReconciliationRow = {
  /** 对账键：默认 sessionID，也可换成 requestID / 模型 / 天。 */
  readonly key: string
  /** 本地记录的金额（美元）。 */
  readonly local: number
  /** provider 账单金额（美元）；没有账单数据时为 null。 */
  readonly provider: number | null
  /** provider - local。provider 为 null 时为 null（无从比较）。 */
  readonly drift: number | null
  /** |drift| / |provider|；provider 为 0 或 null 时为 0。 */
  readonly driftRatio: number
  /** 是否超过阈值。 */
  readonly mismatched: boolean
}

export type ReconciliationReport = {
  readonly generatedAt: string
  readonly threshold: number
  readonly rows: readonly ReconciliationRow[]
  readonly totalLocal: number
  readonly totalProvider: number
  /** provider 账单缺失的行数——比 mismatched 更值得先看：缺账单就无从核销。 */
  readonly missingProvider: number
  readonly mismatchedCount: number
  readonly totalDrift: number
}

/** 从 cost_ledger / stats 侧取到的本地金额。 */
export type LocalEntry = { readonly key: string; readonly amount: number }

/** 从 provider 侧取到的账单金额。key 必须能对应上 LocalEntry.key。 */
export type ProviderEntry = { readonly key: string; readonly amount: number }

/**
 * 对账核心。两侧都按 key 聚合后逐行比较：
 * - 只在本地出现 → provider 为 null，计入 missingProvider（本地记了但没账单）
 * - 只在 provider 出现 → local 记 0，会显式暴露「账单有、账上无」的漏记
 * - 两侧都有 → 计算 drift / driftRatio
 */
export function reconcile(
  local: readonly LocalEntry[],
  provider: readonly ProviderEntry[],
  options?: { readonly threshold?: number; readonly now?: number },
): ReconciliationReport {
  const threshold = options?.threshold ?? 0.01
  const now = options?.now ?? Date.now()

  const localSum = new Map<string, number>()
  for (const entry of local) {
    localSum.set(entry.key, (localSum.get(entry.key) ?? 0) + entry.amount)
  }
  const providerSum = new Map<string, number>()
  for (const entry of provider) {
    providerSum.set(entry.key, (providerSum.get(entry.key) ?? 0) + entry.amount)
  }

  const keys = new Set([...localSum.keys(), ...providerSum.keys()])
  const rows: ReconciliationRow[] = []
  for (const key of [...keys].sort()) {
    const localAmount = localSum.get(key) ?? 0
    const hasProvider = providerSum.has(key)
    const providerAmount = hasProvider ? (providerSum.get(key) as number) : null
    if (providerAmount === null) {
      rows.push({
        key,
        local: localAmount,
        provider: null,
        drift: null,
        driftRatio: 0,
        mismatched: false,
      })
      continue
    }
    const drift = providerAmount - localAmount
    // provider 账单为 0 而本地有花费时，比值没有定义（除零）。
    // 记 0 等于宣称「零差异」，100% 的漏记会被判成未超阈值而静默通过。
    // 约定：分母为 0 且本地也为 0 才是 0；有本地花费则记 1（完全对不上）。
    const driftRatio =
      providerAmount === 0 ? (localAmount === 0 ? 0 : 1) : Math.abs(drift) / Math.abs(providerAmount)
    rows.push({
      key,
      local: localAmount,
      provider: providerAmount,
      drift,
      driftRatio,
      mismatched: driftRatio > threshold,
    })
  }

  return {
    generatedAt: new Date(now).toISOString(),
    threshold,
    rows,
    totalLocal: rows.reduce((sum, row) => sum + row.local, 0),
    totalProvider: rows.reduce((sum, row) => sum + (row.provider ?? 0), 0),
    missingProvider: rows.filter((row) => row.provider === null).length,
    mismatchedCount: rows.filter((row) => row.mismatched).length,
    totalDrift: rows.reduce((sum, row) => sum + (row.drift ?? 0), 0),
  }
}

/** 渲染成给人看的一行行文本，供 `gyc stats --reconcile` 直接打印。 */
export function formatReport(report: ReconciliationReport, limit = 50): string {
  const lines: string[] = []
  lines.push(`成本对账（阈值 ${(report.threshold * 100).toFixed(2)}%）  ${report.generatedAt}`)
  lines.push(`本地合计 $${report.totalLocal.toFixed(6)}   账单合计 $${report.totalProvider.toFixed(6)}`)
  lines.push(`差异合计 $${report.totalDrift.toFixed(6)}   超阈值 ${report.mismatchedCount} 行   缺账单 ${report.missingProvider} 行`)
  const shown = report.rows.slice(0, limit)
  if (shown.length === 0) {
    lines.push("（无对账数据：本地或账单为空）")
    return lines.join("\n")
  }
  for (const row of shown) {
    const provider = row.provider === null ? "（无账单）" : `$${row.provider.toFixed(6)}`
    const drift = row.drift === null ? "-" : `$${row.drift.toFixed(6)}`
    const flag = row.mismatched ? "  ← 超阈值" : row.provider === null ? "  ← 缺账单" : ""
    lines.push(
      `  ${row.key}  本地 $${row.local.toFixed(6)}  账单 ${provider}  差异 ${drift}` +
        `  (${(row.driftRatio * 100).toFixed(2)}%)${flag}`,
    )
  }
  if (report.rows.length > shown.length) {
    lines.push(`  …… 另有 ${report.rows.length - shown.length} 行未显示（可用 --limit 调整）`)
  }
  return lines.join("\n")
}