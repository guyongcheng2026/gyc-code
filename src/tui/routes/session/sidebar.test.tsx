import { afterAll, describe, expect, it, mock } from "bun:test"
import path from "node:path"
import { RGBA } from "@opentui/core"
import { testRender } from "@opentui/solid"

// 侧栏「Workspace Context」信息条渲染回归。
//
// 立项（2026-10-11 稳定性排查）：sidebar.tsx 曾把 <text fg={...}>Workspace Context…</text>
// 嵌套在外层 <text> 内。opentui 0.5.14 的 TextNode renderable 只接受字符串 /
// TextNodeRenderable / StyledText（TextNode.ts:120），<text> 嵌 <text> 在插入时抛
// `TextNodeRenderable only accepts strings, TextNodeRenderable instances, or StyledText instances`，
// 该行渲染异常表现为侧栏工作区信息条反白。修复后内层 text 移出为 box 的直接子节点。

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

// 先取真身 exports，mock 只覆盖 sidebar 用到的入口；afterAll 恢复注册表，
// 避免污染同进程其他测试文件（bun test 单进程共享模块注册表）。
const realTheme = await import("../../context/theme")
const realProject = await import("../../context/project")
const realSync = await import("../../context/sync")
const realConfig = await import("../../config")
const realRuntime = await import("../../plugin/runtime")

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
  [p("../../plugin/runtime.tsx"), () => ({
    ...realRuntime,
    usePluginRuntime: () => ({ Slot: (props: { children?: unknown }) => props.children as never }),
  })],
]
for (const [target, factory] of overrides) mock.module(target, factory)

const { Sidebar } = await import("./sidebar")

afterAll(() => {
  const reals: Record<string, Record<string, unknown>> = {
    [p("../../context/theme.tsx")]: realTheme,
    [p("../../context/project.tsx")]: realProject,
    [p("../../context/sync.tsx")]: realSync,
    [p("../../config/index.tsx")]: realConfig,
    [p("../../plugin/runtime.tsx")]: realRuntime,
  }
  for (const [target] of overrides) mock.module(target, () => reals[target])
})

describe("侧栏工作区信息条", () => {
  it("挂载不抛错且渲染 Workspace Context 行", async () => {
    const setup = await testRender(() => <Sidebar sessionID="s1" />, { width: 80, height: 30 })
    await setup.flush()
    const frame = setup.captureCharFrame()
    expect(frame).toContain("Workspace Context")
    expect(frame).toContain("my-workspace")
  }, 30_000)

  it("tokens 更新不抛错（流式期间每步重算的路径）", async () => {
    const setup = await testRender(() => <Sidebar sessionID="s1" />, { width: 80, height: 30 })
    await setup.flush()
    expect(() => setup.renderOnce()).not.toThrow()
    await setup.flush()
    expect(setup.captureCharFrame()).toContain("Workspace Context")
  }, 30_000)
})
