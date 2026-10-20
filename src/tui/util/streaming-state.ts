/**
 * 流式态稳定器：给「是否正在流式」加滞回，消除工具步骤边界的瞬时翻转。
 *
 * 立项（2026-10-20 抖动排查）：会话页用 pending() 决定帧率档位，但
 * core/session/message-updater.ts 在每个工具步骤边界会先把上一条 assistant
 * 标记 completed、再创建新的未完成消息。两次写入若不在同一批次生效，
 * pending() 就会瞬时变成 undefined，帧率随之在流式档与空闲档之间横跳——
 * 用户感知为「会话结果反馈时画面上下跳」。
 *
 * 语义（与 util/target-fps.ts 的帧率去抖同构）：
 * - 升档立即：raw 变 true 立刻提交为稳定态 true；
 * - 降档保持：raw 变 false 后需持续 holdMs 才提交为 false，期间任何一次
 *   raw 变 true 都会取消挂起的降档；
 * - 同一目标的重复 update 不重置保持期，否则持续空闲时降档会被无限推迟。
 */

export interface StreamingStateOptions {
  /** 降档保持时长（毫秒），默认 300。 */
  holdMs?: number
  setTimeout?: typeof setTimeout
  clearTimeout?: typeof clearTimeout
  /** 稳定态发生变化时回调。 */
  onChange?: (streaming: boolean) => void
}

export interface StreamingState {
  /** 提交一次原始流式态。 */
  update(raw: boolean): void
  /** 当前稳定态。 */
  value(): boolean
  /** 取消挂起的降档。 */
  dispose(): void
}

const DEFAULT_HOLD_MS = 300

export function createStreamingState(options: StreamingStateOptions = {}): StreamingState {
  const holdMs = options.holdMs ?? DEFAULT_HOLD_MS
  const setT = options.setTimeout ?? setTimeout
  const clearT = options.clearTimeout ?? clearTimeout
  let stable = false
  let timer: ReturnType<typeof setTimeout> | undefined

  const cancel = () => {
    if (timer !== undefined) {
      clearT(timer)
      timer = undefined
    }
  }

  const commit = (value: boolean) => {
    if (stable === value) return
    stable = value
    options.onChange?.(value)
  }

  return {
    update(raw) {
      if (raw) {
        // 升档立即：任何时候出现流式输入都立刻回到流式态。
        cancel()
        commit(true)
        return
      }
      if (!stable) return // 已是空闲态，无需动作
      if (timer !== undefined) return // 降档保持期已在计时，不重置
      timer = setT(() => {
        timer = undefined
        commit(false)
      }, holdMs)
      ;(timer as { unref?: () => void }).unref?.()
    },
    value() {
      return stable
    },
    dispose() {
      cancel()
    },
  }
}
