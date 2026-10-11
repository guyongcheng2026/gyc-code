import { afterAll, describe, expect, it, mock } from "bun:test"
import path from "node:path"
import { RGBA } from "@opentui/core"
import { testRender } from "@opentui/solid"

// 侧栏端到端回归：真实 Sidebar + 真实 pluginRuntime（Slot 不 mock）。
//
// 覆盖两类历史缺陷：
//   1) sidebar.tsx 把 <text> 嵌在外层 <text> 内 —— opentui 的 TextNode 只接受
//      string/TextNodeRenderable/StyledText，插入即抛错（反白/异常）。
//   2) plugin slots 的 Slot 用裸 signal 读取（untrack 内不订阅）—— setup() 后
//      永不重渲染，侧栏标题 / Workspace Context / footer / 插件内容整体空白。
// 断言的是「侧栏各区块确实出现在画面上」，而非内部结构，故对两种缺陷都敏感。

const here = import.meta.dir
const p = (rel: string) => path.resolve(here, rel)

const c = (hex: string) => RGBA.fromHex(hex)
const theme = {
  primary: c("#89b4fa"), secondary: c("#cba6f7"), accent: c("#89dceb"), error: c("#f38ba8"),
  warning: c("#f9e2af"), success: c("#a6e3a1"), info: c("#89dceb"), text: c("#cdd6f4"),
  textMuted: c("#a6adc8"), selectedListItemText: c("#1e1e2e"), background: c("#1e1e2e"),
  backgroundPanel: c("#181825"), backgroundElement: c("#313244"), backgroundMenu: c("#313244"),
  border: c("#45475a"), borderActive: c("#89b4fa"), borderSubtle: c("#313244"),
}

const realTheme = await import("../../context/theme")
const realProject = await import("../../context/project")
const realSync = await import("../../context/sync")
const realConfig = await import("../../config")

const overrides: [string, () => Record<string, unknown>][] = [
  [p("../../context/theme.tsx"), () => ({ ...realTheme, useTheme: () => ({ theme }) })],
  [p("../../context/project.tsx"), () => ({
    ...realProject,
    useProject: () => ({
      workspace: {
        get: (id: string) => ({ id, type: "project", name: "my-workspace" }),
        status: () => "connected",
        current: () => "ws1",
      },
    }),
  })],
  [p("../../context/sync.tsx"), () => ({
    ...realSync,
    useSync: () => ({
      session: { get: () => ({ id: "s1", title: "会话标题", workspaceID: "ws1" }) },
      data: {
        session: [
          {
            id: "s1",
            workspaceID: "ws1",
            tokens: { input: 100, output: 200, reasoning: 0, cache: { read: 0, write: 0 } },
            cost: 0.5,
          },
        ],
      },
    }),
  })],
  [p("../../config/index.tsx"), () => ({ ...realConfig, useTuiConfig: () => ({}) })],
]
for (const [target, factory] of overrides) mock.module(target, factory)

const { Sidebar } = await import("./sidebar")
const { createPluginRuntime, PluginRuntimeProvider } = await import("../../plugin/runtime")

afterAll(() => {
  const reals: Record<string, Record<string, unknown>> = {
    [p("../../context/theme.tsx")]: realTheme,
    [p("../../context/project.tsx")]: realProject,
    [p("../../context/sync.tsx")]: realSync,
    [p("../../config/index.tsx")]: realConfig,
  }
  for (const [target] of overrides) mock.module(target, () => reals[target])
})

describe("侧栏端到端渲染", () => {
  it("setup 后标题 / Workspace Context / footer 均可见", async () => {
    const runtime = createPluginRuntime()
    const setup = await testRender(
      () => (
        <PluginRuntimeProvider value={runtime}>
          <Sidebar sessionID="s1" />
        </PluginRuntimeProvider>
      ),
      { width: 80, height: 30 },
    )
    await setup.flush()

    // 插件宿主启动（真实链路里的 setupSlots）之前，Slot 下内容不可见
    runtime.setupSlots({ renderer: setup.renderer, theme } as never)
    await setup.flush()

    const frame = setup.captureCharFrame()
    expect(frame).toContain("会话标题")
    expect(frame).toContain("my-workspace")
    expect(frame).toContain("Workspace Context")
    expect(frame).toContain("GYC")
  }, 30_000)

  it("插件注册到 sidebar_content 的内容可见（工作目录/LSP 通路）", async () => {
    const runtime = createPluginRuntime()
    const setup = await testRender(
      () => (
        <PluginRuntimeProvider value={runtime}>
          <Sidebar sessionID="s1" />
        </PluginRuntimeProvider>
      ),
      { width: 80, height: 30 },
    )
    await setup.flush()

    const slots = runtime.setupSlots({ renderer: setup.renderer, theme } as never)
    slots.register({
      id: "test-plugin",
      slots: {
        sidebar_content: () => <text>PLUGIN-CONTENT-MARKER</text>,
      },
    } as never)
    await setup.flush()

    expect(setup.captureCharFrame()).toContain("PLUGIN-CONTENT-MARKER")
  }, 30_000)
})
