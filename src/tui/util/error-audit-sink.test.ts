import { describe, expect, it } from "bun:test"
import { mkdtempSync, readFileSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import path from "node:path"
import { dispatchErrorAudit } from "@core/observability/error-audit"
import { installTuiErrorAuditSink } from "./error-audit-sink"

// 回归：TUI 进程必须能把错误审计写进日志文件。
// 此前 sink 只在 app-runtime 注入，TUI 链没有 Database.Service → sink 恒空 →
// 渲染异常在 error_audit 表与 gyccode.log 里都留不下痕迹。
describe("installTuiErrorAuditSink", () => {
  it("注入后审计记录落到日志文件，卸载后停止", async () => {
    const dir = mkdtempSync(path.join(tmpdir(), "gyc-audit-"))
    const file = path.join(dir, "gyccode.log")
    const uninstall = installTuiErrorAuditSink(file)
    try {
      dispatchErrorAudit({ scope: "tui.render", message: "boom: TextNodeRenderable", sessionID: undefined })
      // dispatchErrorAudit 用 queueMicrotask 异步写，等一拍
      await new Promise((r) => setTimeout(r, 20))
      const content = readFileSync(file, "utf8")
      expect(content).toContain("scope=tui.render")
      expect(content).toContain("TextNodeRenderable")
      expect(content).toContain("level=Error")
    } finally {
      uninstall()
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it("卸载后不再写入新记录", async () => {
    const dir = mkdtempSync(path.join(tmpdir(), "gyc-audit-"))
    const file = path.join(dir, "gyccode.log")
    const uninstall = installTuiErrorAuditSink(file)
    dispatchErrorAudit({ scope: "tui.a", message: "first" })
    await new Promise((r) => setTimeout(r, 20))
    uninstall()
    dispatchErrorAudit({ scope: "tui.b", message: "second" })
    await new Promise((r) => setTimeout(r, 20))
    const content = readFileSync(file, "utf8")
    expect(content).toContain("first")
    expect(content).not.toContain("second")
    rmSync(dir, { recursive: true, force: true })
  })
})
