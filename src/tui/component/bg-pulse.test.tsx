import { describe, expect, it, mock } from "bun:test"
import path from "node:path"
import { RGBA } from "@opentui/core"
import { testRender } from "@opentui/solid"
import { createStore } from "solid-js/store"

// 脉冲动效组件的生命周期回归。
//
// 覆盖两类历史缺陷：
//   1) 动画开关读取非响应式 —— Solid 的 createComponent 用 untrack 执行组件体，
//      组件体内直接读 kv.get 不建立依赖，挂载后再切换 animations_enabled
//      不会生效（旧实现因此关不掉动画，动效继续占帧）。
//   2) 卸载时帧率恢复会覆盖他人在存活期间的设置 —— 旧实现对 maxFps 无条件恢复，
//      若期间有别的组件改了 maxFps，恢复动作会把它打回快照值。

const here = import.meta.dir
const p = (rel: string) => path.resolve(here, rel)

const c = (hex: string) => RGBA.fromHex(hex)
const theme = {
  primary: c("#89b4fa"),
  secondary: c("#cba6f7"),
  accent: c("#89dceb"),
  error: c("#f38ba8"),
  warning: c("#f9e2af"),
  success: c("#a6e3a1"),
  info: c("#89dceb"),
  text: c("#cdd6f4"),
  textMuted: c("#a6adc8"),
  selectedListItemText: c("#1e1e2e"),
  background: c("#1e1e2e"),
  backgroundPanel: c("#181825"),
  backgroundElement: c("#313244"),
  backgroundMenu: c("#313244"),
  border: c("#45475a"),
  borderActive: c("#89b4fa"),
  borderSubtle: c("#313244"),
}

const realTheme = await import("../context/theme")

// 假 kv：用 createStore 复刻真实实现（Solid store 代理 → 读是响应式的）
const [kvStore, setKvStore] = createStore<Record<string, unknown>>({ animations_enabled: false })
const fakeKv = {
  get ready() {
    return true
  },
  get store() {
    return kvStore
  },
  signal<T>(name: string, defaultValue: T) {
    return [() => fakeKv.get(name, defaultValue), (v: T) => fakeKv.set(name, v)] as const
  },
  get(key: string, defaultValue?: unknown) {
    return kvStore[key] ?? defaultValue
  },
  set(key: string, value: unknown) {
    setKvStore(key, value)
  },
}

mock.module(p("../context/theme.tsx"), () => ({ ...realTheme, useTheme: () => ({ theme }) }))
mock.module(p("../context/kv.tsx"), () => ({ useKV: () => fakeKv }))

const { BgPulse } = await import("./bg-pulse")

describe("BgPulse 动画开关与帧率归属", () => {
  it("动画关闭：不挂载动效节点，也不改动帧率", async () => {
    setKvStore("animations_enabled", false)
    const setup = await testRender(() => <BgPulse />, { width: 40, height: 10 })
    // 动效是 live 的，渲染器不会进入 visual idle，故不使用 flush()。
    await setup.renderOnce()

    expect(setup.renderer.root.getChildren().length).toBe(0)
    // 关闭时不得改写任何帧率设置
    expect(setup.renderer.targetFps).toBe(30)
    expect(setup.renderer.maxFps).toBe(60)
  })

  it("动画开启：挂载动效节点并把帧率压到 12", async () => {
    setKvStore("animations_enabled", true)
    const setup = await testRender(() => <BgPulse />, { width: 40, height: 10 })
    await setup.waitFor(() => setup.renderer.targetFps === 12)

    expect(setup.renderer.root.getChildren().length).toBeGreaterThan(0)
    expect(setup.renderer.targetFps).toBe(12)
    expect(setup.renderer.maxFps).toBe(12)
  })

  it("挂载后关闭动画：动效节点卸载，帧率恢复原值", async () => {
    setKvStore("animations_enabled", false)
    const setup = await testRender(() => <BgPulse />, { width: 40, height: 10 })
    const originalFps = setup.renderer.targetFps
    const originalMaxFps = setup.renderer.maxFps

    setKvStore("animations_enabled", true)
    await setup.waitFor(() => setup.renderer.targetFps === 12)
    expect(setup.renderer.targetFps).toBe(12)

    setKvStore("animations_enabled", false)
    await setup.waitFor(() => setup.renderer.targetFps === originalFps)

    expect(setup.renderer.root.getChildren().length).toBe(0)
    expect(setup.renderer.targetFps).toBe(originalFps)
    expect(setup.renderer.maxFps).toBe(originalMaxFps)
  })

  it("关闭动画时不覆盖他人在存活期间设置的帧率", async () => {
    setKvStore("animations_enabled", false)
    const setup = await testRender(() => <BgPulse />, { width: 40, height: 10 })

    setKvStore("animations_enabled", true)
    await setup.waitFor(() => setup.renderer.targetFps === 12)

    // 模拟会话路由接管：把帧率改成流式档
    setup.renderer.targetFps = 60
    setup.renderer.maxFps = 60

    setKvStore("animations_enabled", false)
    await setup.waitFor(() => setup.renderer.root.getChildren().length === 0)

    // 不得把 60 打回 12（也不得动 maxFps）
    expect(setup.renderer.targetFps).toBe(60)
    expect(setup.renderer.maxFps).toBe(60)
  })
})
