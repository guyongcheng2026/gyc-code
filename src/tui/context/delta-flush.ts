// 流式 delta 的自适应上屏调度器。
// 对标 pi agent 的 16ms（60fps）流式节奏（pi-tui MIN_RENDER_INTERVAL_MS=16，
// 每个 message_update 直接 requestRender）：
// - 涓流（token 间隔 ≥ 窗口）：立即排空，逐 token 直出，首字延迟趋近 0
// - 洪泛：按固定窗口合并为一次 store 写，避免每 token 触发整块 markdown
//   重解析（tree-sitter WASM），这正是旧版 30ms 固定攒批的初衷
export const DELTA_FLUSH_MS = 30

export function nextFlushDelayMs(lastFlushAt: number, now: number, intervalMs = DELTA_FLUSH_MS): number {
  const elapsed = now - lastFlushAt
  // elapsed < 0（时钟回拨）与已满窗口同样立即排空，避免算出负延迟
  if (elapsed < 0 || elapsed >= intervalMs) return 0
  return intervalMs - elapsed
}

export type DeltaFlushController = {
  schedule(): void
  dispose(): void
}

export function createDeltaFlushController(flush: () => void, intervalMs = DELTA_FLUSH_MS): DeltaFlushController {
  let timer: ReturnType<typeof setTimeout> | undefined
  let lastFlushAt = 0
  return {
    schedule() {
      if (timer !== undefined) return
      timer = setTimeout(
        () => {
          timer = undefined
          lastFlushAt = performance.now()
          flush()
        },
        nextFlushDelayMs(lastFlushAt, performance.now(), intervalMs),
      )
    },
    dispose() {
      if (timer === undefined) return
      clearTimeout(timer)
      timer = undefined
    },
  }
}
