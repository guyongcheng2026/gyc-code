// 技能生命周期自动转换：纯确定性规则，不调用模型。
//
// 依据 Hermes curator 的两段式老化时钟（stale / archive），并保留一条免疫规则：
// pinned 技能由谷总显式锁定，自动流程永不改动它。
//
// 自动转换只调整 .usage.json 里的状态元数据，**不搬迁目录**。归档搬目录是显式
// 动作（走 skill-store 的 archive），避免自动流程动到文件系统。

import { setState, type SkillUsageTable } from "./usage"

export interface LifecycleConfig {
  /** 闲置超过该天数标记为 stale */
  readonly staleAfterDays: number
  /** 闲置超过该天数归档 */
  readonly archiveAfterDays: number
}

export const DEFAULT_LIFECYCLE_CONFIG: LifecycleConfig = {
  staleAfterDays: 30,
  archiveAfterDays: 90,
}

export interface Transition {
  readonly name: string
  readonly to: "active" | "stale" | "archived"
}

const DAY_MS = 24 * 60 * 60 * 1000

/**
 * 规划本轮的转换动作。返回值按 name 排序，保证同输入同输出。
 *
 * 规则（自上而下，先命中先赢）：
 * 1. pinned → 永不转换
 * 2. 已归档且近期有活动 → 重新激活为 active
 * 3. 闲置超过 archiveAfterDays → archived
 * 4. 闲置超过 staleAfterDays → stale
 * 5. 其余保持不动
 *
 * 「从未被用过」（useCount 与 viewCount 均为 0）的技能，其 lastActivityAt 就是
 * createdAt，因此规则 3/4 天然给了它一个 stale 周期的宽限期，无需单独分支。
 */
export function planTransitions(
  usage: SkillUsageTable,
  options: { now: number; config?: LifecycleConfig },
): Transition[] {
  const config = options.config ?? DEFAULT_LIFECYCLE_CONFIG
  const now = options.now
  const staleMs = config.staleAfterDays * DAY_MS
  const archiveMs = config.archiveAfterDays * DAY_MS

  const transitions: Transition[] = []

  for (const [name, entry] of Object.entries(usage)) {
    if (entry.pinned) continue

    const idleMs = now - entry.lastActivityAt
    let to: Transition["to"] | undefined

    if (entry.state === "archived") {
      if (idleMs <= staleMs) to = "active"
    } else if (idleMs > archiveMs) {
      to = "archived"
    } else if (idleMs > staleMs) {
      to = "stale"
    }

    // 目标状态与当前一致时不产生动作，避免无谓写入
    if (to !== undefined && to !== entry.state) transitions.push({ name, to })
  }

  return transitions.toSorted((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0))
}

/**
 * 落实转换动作。任何失败都只记录、不向上抛——自动转换是维护性动作，
 * 不能因为某个技能写不进去就影响会话启动。
 */
export async function applyTransitions(root: string, transitions: readonly Transition[]): Promise<void> {
  for (const transition of transitions) {
    try {
      await setState(root, transition.name, transition.to)
    } catch (error) {
      console.warn(
        `[learning] 生命周期转换失败：${transition.name} -> ${transition.to}`,
        error instanceof Error ? error.message : String(error),
      )
    }
  }
}
