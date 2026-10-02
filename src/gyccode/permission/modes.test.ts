import { describe, expect, it } from "bun:test"
import { fromTuiAutoFlag, resolveAction, writeDangerLevel } from "./modes"
import type { PermissionMode } from "./modes"

/**
 * R-1（对标指标 22 · 权限与沙箱边界 · P0）
 *
 * 此前 `resolveAction` 定义了但全仓无人 import——四种模式对 shell 安全性毫无
 * 影响，枚举写了没接线。这里锁定裁决矩阵：模式必须真的改变 allow/ask/deny，
 * 且「用户说绕过就全绕过」在 blocked 级上不成立。
 */

const LEVELS = ["safe", "warning", "dangerous", "blocked"] as const
const MODES: ReadonlyArray<PermissionMode> = ["default", "acceptEdits", "bypassPermissions", "plan"]

describe("resolveAction（R-1 模式裁决矩阵）", () => {
  it("default 模式：blocked 拒绝、dangerous/warning 询问、safe 放行", () => {
    expect(resolveAction("blocked", "default")).toBe("deny")
    expect(resolveAction("dangerous", "default")).toBe("ask")
    expect(resolveAction("warning", "default")).toBe("ask")
    expect(resolveAction("safe", "default")).toBe("allow")
  })

  it("default 与 acceptEdits 在 dangerous/blocked 上行为一致（不放宽危险执行）", () => {
    expect(resolveAction("dangerous", "acceptEdits")).toBe("ask")
    expect(resolveAction("blocked", "acceptEdits")).toBe("deny")
  })

  it("acceptEdits 只自动放行 warning 级", () => {
    expect(resolveAction("warning", "acceptEdits")).toBe("allow")
  })

  it("bypassPermissions 直通 safe/warning/dangerous", () => {
    expect(resolveAction("safe", "bypassPermissions")).toBe("allow")
    expect(resolveAction("warning", "bypassPermissions")).toBe("allow")
    expect(resolveAction("dangerous", "bypassPermissions")).toBe("allow")
  })

  it("bypassPermissions 仍不放行 blocked 级（裁决 1：安全相关保守）", () => {
    expect(resolveAction("blocked", "bypassPermissions")).toBe("deny")
  })

  it("plan 模式对全部危险等级都拒绝（调用方只在写/执行类权限上调用本函数）", () => {
    for (const level of LEVELS) {
      expect(resolveAction(level, "plan"), level).toBe("deny")
    }
  })

  it("模式确实改变裁决结果——acceptEdits / bypassPermissions / plan 均与 default 有差异", () => {
    // default 自己与 default 比恒等，必须排除，否则这条断言是自证的
    for (const mode of MODES.filter((m) => m !== "default")) {
      const differs = LEVELS.some((level) => resolveAction(level, mode) !== resolveAction(level, "default"))
      expect(differs, mode).toBe(true)
    }
  })
})

describe("writeDangerLevel（哪些权限受模式约束）", () => {
  it("写/执行类权限被识别为受模式约束", () => {
    expect(writeDangerLevel("edit")).toBe("warning")
    expect(writeDangerLevel("write")).toBe("warning")
    expect(writeDangerLevel("bash")).toBe("dangerous")
  })

  it("读类权限不受模式约束（plan 模式仍可读文件，否则无法只读分析）", () => {
    expect(writeDangerLevel("read")).toBeUndefined()
    expect(writeDangerLevel("grep")).toBeUndefined()
    expect(writeDangerLevel("glob")).toBeUndefined()
    expect(writeDangerLevel("list")).toBeUndefined()
  })

  it("未登记的权限默认不受模式约束（新增权限不得因漏登记而被误拒）", () => {
    expect(writeDangerLevel("some_future_tool")).toBeUndefined()
  })
})

describe("fromTuiAutoFlag（TUI --auto → 统一模式映射）", () => {
  it("--auto / --yolo 映射为 bypassPermissions", () => {
    expect(fromTuiAutoFlag(true)).toBe("bypassPermissions")
  })

  it("未开启映射为 default", () => {
    expect(fromTuiAutoFlag(false)).toBe("default")
    expect(fromTuiAutoFlag(undefined)).toBe("default")
  })

  it("映射结果都是合法的 PermissionMode（不再自成一套平行类型）", () => {
    expect(MODES).toContain(fromTuiAutoFlag(true))
    expect(MODES).toContain(fromTuiAutoFlag(false))
  })
})