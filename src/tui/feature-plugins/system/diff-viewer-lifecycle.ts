import type { BoxRenderable, DiffRenderable } from "@opentui/core"

/**
 * 差分查看器的渲染生命周期守卫。
 *
 * 立项（2026-10-20 稳定性排查）：diff-viewer 此前用 7 处裸
 * requestAnimationFrame 排帧，回调里写 setPatchFillerHeight /
 * setPendingPatchScrollFileIndex。组件卸载后这些回调仍会执行，
 * 向已销毁组件的信号写值；同时按索引持有的 renderable 引用
 * （patch 节点 / diff 节点）没有清空，强引用 renderable，
 * 依赖 GC 兜底释放原生句柄。
 *
 * 本模块把「排帧 + 引用登记 + 卸载清理」收敛为一个可测对象：
 * - scheduleFrame 捕获当前代际，卸载后代际失效，回调直接返回；
 * - dispose 同时使代际失效并清空两个 renderable 登记表。
 */

/** 按索引持有的 renderable 登记表。 */
export interface RenderableRegistry<T> {
  register(index: number, value: T): void
  get(index: number): T | undefined
  /** 清空引用：卸载时调用，避免强引用 renderable 依赖 GC 释放原生句柄。 */
  clear(): void
  size(): number
}

export function createRenderableRegistry<T>(): RenderableRegistry<T> {
  const items = new Map<number, T>()
  return {
    register(index, value) {
      items.set(index, value)
    },
    get(index) {
      return items.get(index)
    },
    clear() {
      items.clear()
    },
    size() {
      return items.size
    },
  }
}

export interface DiffViewerLifecycle {
  /**
   * 排入一帧回调。生命周期失效（dispose）后，已排程的回调不再执行，
   * 新排程的回调直接丢弃。
   */
  scheduleFrame(callback: () => void): void
  /** patch 面板节点登记表。 */
  patchNodes: RenderableRegistry<BoxRenderable>
  /** diff 面板节点登记表。 */
  diffNodes: RenderableRegistry<DiffRenderable>
  /** 卸载：使挂起的帧回调失效，并清空 renderable 引用。 */
  dispose(): void
  disposed(): boolean
}

export function createDiffViewerLifecycle(
  requestFrame: (callback: () => void) => void = (callback) => requestAnimationFrame(callback),
): DiffViewerLifecycle {
  // 失效标志：dispose 置位后，已排程的回调不再执行，新排程的回调直接丢弃。
  let disposed = false
  const patchNodes = createRenderableRegistry<BoxRenderable>()
  const diffNodes = createRenderableRegistry<DiffRenderable>()

  return {
    scheduleFrame(callback) {
      if (disposed) return
      requestFrame(() => {
        if (disposed) return
        callback()
      })
    },
    patchNodes,
    diffNodes,
    dispose() {
      disposed = true
      patchNodes.clear()
      diffNodes.clear()
    },
    disposed() {
      return disposed
    },
  }
}
