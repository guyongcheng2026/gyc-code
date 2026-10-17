import { describe, expect, test } from "bun:test"
import { createTestKeymap } from "@opentui/keymap/testing"
import { createBindingLookup } from "@opentui/keymap/extras"
import type { CliRenderer, TextareaRenderable } from "@opentui/core"
import { TextareaRenderable as TextareaClass } from "@opentui/core"
import { TuiKeybind } from "./config/keybind"
import { GYCCODE_BASE_MODE, getGyccodeModeStack, registerGyccodeKeymap } from "./keymap"

function setup(commands: string[] = ["model.list"]) {
  const { keymap, host, diagnostics, cleanup } = createTestKeymap({ defaultKeys: true })
  const keybinds = createBindingLookup(TuiKeybind.toBindingConfig(TuiKeybind.parse({})), {
    commandMap: TuiKeybind.CommandMap,
    bindingDefaults: TuiKeybind.bindingDefaults(),
  })
  const config = { keybinds, leader_timeout: 2000 }
  const counts = new Map<string, number>()
  const renderer = {
    isDestroyed: false,
    currentFocusedEditor: undefined as unknown,
    on: () => () => {},
    off: () => {},
  } as unknown as CliRenderer
  // 仿真实顺序：app.tsx 先注册 keymap（含 parser），组件挂载时才 registerLayer 编译绑定
  const off = registerGyccodeKeymap(keymap as never, renderer, config as never)
  const bindings = [...keybinds.gather("app", commands), ...keybinds.gather("app.global", commands)]
  keymap.registerLayer({
    commands: commands.map((name) => ({
      namespace: "palette",
      name,
      title: name,
      run: () => {
        counts.set(name, (counts.get(name) ?? 0) + 1)
      },
    })),
    bindings: bindings as never,
    mode: GYCCODE_BASE_MODE,
  })
  const press = (name: string, mods?: { ctrl?: boolean; shift?: boolean; meta?: boolean }) => host.press(name, mods)
  return {
    keymap,
    diagnostics,
    press,
    cleanup: () => {
      off()
      cleanup()
    },
    count: (name = "model.list") => counts.get(name) ?? 0,
    setFocus: (editor: unknown) => {
      Reflect.set(renderer as object, "currentFocusedEditor", editor)
    },
    pushMode: (mode: string) => getGyccodeModeStack(keymap as never).push(mode),
  }
}

type Harness = ReturnType<typeof setup>

function pressLeader(t: Harness, tail: string, mods?: { ctrl?: boolean; shift?: boolean }) {
  t.press("x", { ctrl: true })
  t.press(tail, mods)
}

const leaderKeyNames = /^[a-z0-9]$/

const leaderCases = Object.entries(TuiKeybind.Definitions).flatMap(([bindName, def]) => {
  if (typeof def.default !== "string") return []
  const command = TuiKeybind.CommandMap[bindName as keyof typeof TuiKeybind.CommandMap]
  if (!command) return []
  return def.default
    .split(",")
    .map((part) => part.trim())
    .filter((part) => part.startsWith("<leader>"))
    .map((part) => ({ bindName, command, tail: part.slice("<leader>".length) }))
})

describe("leader 快捷键链路（model.list 代表场景）", () => {
  test("ctrl+x 然后 m 应触发 model.list", () => {
    const t = setup()
    t.press("x", { ctrl: true })
    expect(t.keymap.getPendingSequence().length).toBeGreaterThan(0)
    t.press("m")
    expect(t.count()).toBe(1)
    t.cleanup()
  })

  test("ctrl+x 然后 M（shift+m）应触发 model.list", () => {
    const t = setup()
    pressLeader(t, "m", { shift: true })
    expect(t.count()).toBe(1)
    t.cleanup()
  })

  test("ctrl+x 后仍按住 ctrl 按 m 应触发 model.list", () => {
    const t = setup()
    pressLeader(t, "m", { ctrl: true })
    expect(t.count()).toBe(1)
    t.cleanup()
  })

  test("leader 等待超时后 pending 应清除", async () => {
    const t = setup()
    t.press("x", { ctrl: true })
    expect(t.keymap.getPendingSequence().length).toBeGreaterThan(0)
    await new Promise((resolve) => setTimeout(resolve, 2100))
    expect(t.keymap.getPendingSequence().length).toBe(0)
    t.cleanup()
  })

  test("输入框聚焦（textarea）时 ctrl+x 然后 m 仍应触发", () => {
    const t = setup()
    const editor = Object.create(TextareaClass.prototype) as TextareaRenderable
    Reflect.set(editor, "isDestroyed", false)
    t.setFocus(editor)
    pressLeader(t, "m")
    expect(t.count()).toBe(1)
    t.cleanup()
  })

  test("modal mode 下 leader 仍可用且弹窗关闭后恢复", () => {
    const t = setup()
    const pop = t.pushMode("modal")
    pressLeader(t, "m")
    const ranInModal = t.count()
    pop()
    pressLeader(t, "m")
    expect(t.count()).toBe(ranInModal + 1)
    t.cleanup()
  })

  test("诊断无错误", () => {
    const t = setup()
    pressLeader(t, "m")
    expect(t.diagnostics.takeErrors().errors).toEqual([])
    t.cleanup()
  })
})

describe.each(leaderCases)("leader 绑定 $bindName → $command", ({ command, tail }) => {
  test("小写/原样按键触发", () => {
    const t = setup([command])
    pressLeader(t, tail)
    expect(t.count(command)).toBe(1)
    t.cleanup()
  })

  if (leaderKeyNames.test(tail)) {
    test("大写 M（shift+键）姿势触发", () => {
      const t = setup([command])
      pressLeader(t, tail, { shift: true })
      expect(t.count(command)).toBe(1)
      t.cleanup()
    })

    test("ctrl 未松（ctrl+键）姿势触发", () => {
      const t = setup([command])
      pressLeader(t, tail, { ctrl: true })
      expect(t.count(command)).toBe(1)
      t.cleanup()
    })
  }
})

describe("大写字母绑定（diff.expand_all: \"E\"）", () => {
  test("按 shift+e（大写 E 姿势）应触发", () => {
    const t = setup(["diff.expand_all"])
    t.press("e", { shift: true })
    expect(t.count("diff.expand_all")).toBe(1)
    t.cleanup()
  })

  test("按纯 e 不应误触发大写绑定", () => {
    const t = setup(["diff.expand_all"])
    t.press("e")
    expect(t.count("diff.expand_all")).toBe(0)
    t.cleanup()
  })
})
