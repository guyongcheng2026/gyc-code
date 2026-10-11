/**
 * 会话视图的帧率控制器：流式升档立即、空闲降档去抖。
 *
 * 立项（2026-10-11 抖动排查）：此前 routes/session/index.tsx 的 createEffect 直接写
 * `renderer.targetFps = sessionTargetFps(probeTerminal(), pending() !== undefined, renderScale())`，
 * 而 `pending()` 在**工具步骤边界反复翻转**——message-updater.ts 的
 * `session.next.step.started` 先把上一条 assistant 消息标记 `time.completed` 再创建
 * 新的未完成消息（:192-217），`step.ended` 又置 `completed`（:215），而一次工具调用
 * 即一个 step。于是帧率在流式档（60）与空闲档（30）之间每步来回横跳（capability.ts:147-156），
 * 画面节奏突变 —— 用户感知为「会话结果反馈时画面上下跳」。
 *
 * 上游 MiMo-Code 在创建时一次性固定（`targetFps: plainTerminal ? 10 : 60`，
 * packages/cli/src/cli/cmd/tui/app.tsx），不存在该问题。但 gyc 的
 * 「流式升档 / 空闲回落」是刻意的 CPU 优化（长会话按消息数继续降档），
 * 故保留能力，只消除高频翻转：升档立即，降档需空闲持续 downgradeDelayMs 后才应用；
 * 期间任何一次流式都会取消挂起的降档。
 */
export interface FpsController {
  /** 请求目标帧率；streaming=true 表示正在流式输出（升档立即生效）。 */
  request(target: number, streaming: boolean): void
  /** 取消挂起的降档。 */
  dispose(): void
}

export function createFpsController(
  apply: (fps: number) => void,
  options: {
    downgradeDelayMs?: number
    setTimeout?: typeof setTimeout
    clearTimeout?: typeof clearTimeout
  } = {},
): FpsController {
  const delay = options.downgradeDelayMs ?? 3000
  const setT = options.setTimeout ?? setTimeout
  const clearT = options.clearTimeout ?? clearTimeout
  let timer: ReturnType<typeof setTimeout> | undefined
  let current: number | undefined

  const cancel = () => {
    if (timer !== undefined) {
      clearT(timer)
      timer = undefined
    }
  }
  const applyNow = (fps: number) => {
    if (current === fps) return
    current = fps
    apply(fps)
  }

  return {
    request(target, streaming) {
      // 流式升档、首次设定、以及任何非降档变化：立即生效，并取消挂起的降档
      if (streaming || current === undefined || target >= current) {
        cancel()
        applyNow(target)
        return
      }
      // 空闲降档：等空闲持续到阈值再应用
      cancel()
      timer = setT(() => {
        timer = undefined
        applyNow(target)
      }, delay)
      ;(timer as { unref?: () => void }).unref?.()
    },
    dispose() {
      cancel()
    },
  }
}
