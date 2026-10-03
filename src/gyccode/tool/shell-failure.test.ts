import { describe, expect, test } from "bun:test"
import { shellFailureNotice } from "./shell"

describe("shellFailureNotice", () => {
  test("Error 失败：回灌结构化文案并带上命令原文与原因", () => {
    const text = shellFailureNotice({ command: "git status", shell: "bash" }, new Error("spawn ENOENT"))
    expect(text).toContain(`kind="shell_failed"`)
    expect(text).toContain(`tool="bash"`)
    expect(text).toContain("git status")
    expect(text).toContain("spawn ENOENT")
    expect(text).toContain("allowDangerous")
    expect(text.trimEnd().endsWith("</tool_error>")).toBe(true)
  })

  test("非 Error 值：仍能取到可读原因且不抛异常", () => {
    const text = shellFailureNotice({ command: "pwd", shell: "bash" }, "broken pipe")
    expect(text).toContain(`kind="shell_failed"`)
    expect(text).toContain("pwd")
    expect(text).toContain("broken pipe")
  })
})