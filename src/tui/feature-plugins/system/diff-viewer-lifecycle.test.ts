import { describe, expect, it } from "bun:test"
import { createDiffViewerLifecycle } from "./diff-viewer-lifecycle"

// 差分查看器的渲染生命周期回归。
//
// 覆盖两类历史缺陷：
//   1) 组件卸载后，已排程的 requestAnimationFrame 回调仍会执行，
//      向已销毁组件的信号写值（setPatchFillerHeight / setPendingPatchScrollFileIndex）。
//   2) 按索引持有的 renderable 引用（patch 节点 / diff 节点）在卸载时未清空，
//      强引用 renderable，依赖 GC 兜底释放原生句柄。

describe("diff-viewer 生命周期", () => {
  it("卸载前排程的回调会执行", () => {
    const frames: Array<() => void> = []
    const lifecycle = createDiffViewerLifecycle((cb) => frames.push(cb))
    let ran = 0
    lifecycle.scheduleFrame(() => {
      ran += 1
    })

    expect(frames.length).toBe(1)
    frames[0]!()
    expect(ran).toBe(1)
  })

  it("卸载后排程的回调不再执行", () => {
    const frames: Array<() => void> = []
    const lifecycle = createDiffViewerLifecycle((cb) => frames.push(cb))
    let ran = 0
    lifecycle.scheduleFrame(() => {
      ran += 1
    })

    lifecycle.dispose()
    frames[0]!()
    expect(ran).toBe(0)
  })

  it("嵌套排帧：外层执行后排入的内层回调在卸载后也不再执行", () => {
    const frames: Array<() => void> = []
    const lifecycle = createDiffViewerLifecycle((cb) => frames.push(cb))
    const ran: string[] = []
    lifecycle.scheduleFrame(() => {
      ran.push("outer")
      lifecycle.scheduleFrame(() => {
        ran.push("inner")
      })
    })

    frames[0]!()
    expect(frames.length).toBe(2)

    lifecycle.dispose()
    frames[1]!()
    expect(ran).toEqual(["outer"])
  })

  it("卸载后不再排入新的帧回调", () => {
    const frames: Array<() => void> = []
    const lifecycle = createDiffViewerLifecycle((cb) => frames.push(cb))
    lifecycle.dispose()
    lifecycle.scheduleFrame(() => {})
    expect(frames.length).toBe(0)
  })

  it("卸载时清空 renderable 引用", () => {
    const lifecycle = createDiffViewerLifecycle()
    lifecycle.patchNodes.register(0, { id: "patch-0" } as never)
    lifecycle.diffNodes.register(1, { id: "diff-1" } as never)
    expect(lifecycle.patchNodes.size()).toBe(1)
    expect(lifecycle.diffNodes.size()).toBe(1)

    lifecycle.dispose()

    expect(lifecycle.patchNodes.size()).toBe(0)
    expect(lifecycle.diffNodes.size()).toBe(0)
    expect(lifecycle.patchNodes.get(0)).toBeUndefined()
    expect(lifecycle.diffNodes.get(1)).toBeUndefined()
  })

  it("卸载是幂等的", () => {
    const frames: Array<() => void> = []
    const lifecycle = createDiffViewerLifecycle((cb) => frames.push(cb))
    let ran = 0
    lifecycle.scheduleFrame(() => {
      ran += 1
    })
    lifecycle.dispose()
    lifecycle.dispose()
    frames[0]!()
    expect(ran).toBe(0)
    expect(lifecycle.disposed()).toBe(true)
  })
})
