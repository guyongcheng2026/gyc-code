/**
 * 句柄预算压力档位（内存守护的补盲维度）。
 *
 * 为什么需要独立维度：opentui 的原生 buffer/句柄内存**不受 V8 堆上限约束**。
 * app.tsx 的内存守护只看 rss / heapRatio / freemem，当原生句柄吃掉大部分物理
 * 内存时，heapRatio 可能仍然正常，于是要等到 freemem 掉下去才动作——此时
 * V8 C++ 层往往已先触发 FatalOOM abort（不可捕获的进程 abort）。
 *
 * 本档位让守护提前在「句柄预算即将耗尽」时降级，而不是等物理内存被吃光。
 */

/** 压力档位：none 无压力 / warn 偏高 / critical 逼近耗尽。 */
export type HandlePressure = "none" | "warn" | "critical"

/**
 * 按句柄预算占用率给出压力档位。
 *
 * 阈值：≥60% warn，≥80% critical。limit ≤ 0 表示预算未启用（无限制），
 * 视为无压力。
 */
export function handleBudgetPressure(used: number, limit: number): HandlePressure {
  if (!Number.isFinite(limit) || limit <= 0) return "none"
  const ratio = used / limit
  if (ratio >= 0.8) return "critical"
  if (ratio >= 0.6) return "warn"
  return "none"
}
