// 工具迭代触发判定：累计本轮会话的工具迭代次数，达到阈值就提示做一次技能沉淀复习。
// 纯内存小状态机：不读时钟、不碰文件系统、不依赖任何外部单例，便于在会话层按需创建与重置。
export interface TriggerConfig {
  /** 累计多少次工具迭代后提示复习一次 */
  readonly nudgeInterval: number
}

export const DEFAULT_TRIGGER_CONFIG: TriggerConfig = { nudgeInterval: 10 }

export interface Trigger {
  /** 累加工具迭代次数；0、负数、NaN 等非法输入一律忽略 */
  addToolIterations(count: number): void
  /** 纯查询：累计值已达阈值且本会话尚未 markReviewed() 时为真，调用本身不改任何状态 */
  shouldReview(): boolean
  /** 记下「本会话已复习」；此后 shouldReview() 恒为假，直到 reset() */
  markReviewed(): void
  /** 清空累计值与已复习标记 */
  reset(): void
  /** 当前累计的工具迭代次数 */
  toolIterations(): number
}

/** 只接受有限正数；其余（0、负数、NaN、Infinity）折算为不计数。 */
function acceptedCount(count: number): number {
  return Number.isFinite(count) && count > 0 ? count : 0
}

export function createTrigger(config: TriggerConfig = DEFAULT_TRIGGER_CONFIG): Trigger {
  // 阈值配置坏了就退回默认值，免得出现「间隔 0 导致每次都提示」这种失控行为。
  const nudgeInterval =
    Number.isFinite(config.nudgeInterval) && config.nudgeInterval > 0
      ? config.nudgeInterval
      : DEFAULT_TRIGGER_CONFIG.nudgeInterval

  let total = 0
  let reviewed = false

  return {
    addToolIterations: (count: number): void => {
      total += acceptedCount(count)
    },
    shouldReview: (): boolean => !reviewed && total >= nudgeInterval,
    markReviewed: (): void => {
      reviewed = true
    },
    reset: (): void => {
      total = 0
      reviewed = false
    },
    toolIterations: (): number => total,
  }
}
