import { describe, expect, it } from "bun:test"
import { testRender } from "@opentui/solid"
import { createPluginRuntime } from "./runtime"

// 回归：Slot 必须对 setup()/clear() 有响应。
//
// 立项（2026-10-11 稳定性排查）：`Slot` 曾写成 `(props) => view()(props)` 的裸调用。
// solid 的 createComponent 用 untrack 包裹组件体，裸调用只在组件体求值时读一次
// signal、不建立订阅，于是 setup() 内的 setView 永远不触发重渲染，Slot 恒为初始
// 的 `empty`（返回 null）——表现为侧栏标题、Workspace Context、footer 以及
// sidebar_content 里由插件提供的工作目录/LSP 等**整体空白**。
// 修复：把读取放进 JSX 表达式（编译为 render effect，signal 进追踪域）。
describe("pluginRuntime.Slot 响应式", () => {
  async function mount() {
    const runtime = createPluginRuntime()
    const setup = await testRender(
      () => (
        <runtime.Slot name="sidebar_title" mode="single_winner" session_id="s1" title="t">
          <text>SLOT-MARKER</text>
        </runtime.Slot>
      ),
      { width: 40, height: 5 },
    )
    await setup.flush()
    return { runtime, setup }
  }

  it("setup 前渲染空，setup 后渲染 children", async () => {
    const { runtime, setup } = await mount()
    expect(setup.captureCharFrame()).not.toContain("SLOT-MARKER")

    runtime.setupSlots({ renderer: setup.renderer, theme: {} } as never)
    await setup.flush()
    expect(setup.captureCharFrame()).toContain("SLOT-MARKER")
  }, 30_000)

  it("clear 后恢复空（插件宿主 dispose 路径）", async () => {
    const { runtime, setup } = await mount()
    runtime.setupSlots({ renderer: setup.renderer, theme: {} } as never)
    await setup.flush()
    expect(setup.captureCharFrame()).toContain("SLOT-MARKER")

    runtime.clear()
    await setup.flush()
    expect(setup.captureCharFrame()).not.toContain("SLOT-MARKER")
  }, 30_000)
})
