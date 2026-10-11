/**
 * TUI 进程的错误审计落盘通道。
 *
 * 背景（2026-10-11 稳定性排查）：`setErrorAuditSink` 此前只在
 * `src/gyccode/effect/app-runtime.ts:188` 注入，而 TUI 进程（bin/gyc →
 * src/cli/cmd/tui.ts）走的是另一条链、根本没有 Database.Service，于是 sink
 * 恒为 undefined：`dispatchErrorAudit` 直接 return，`logError` 的内容只进
 * console —— 全屏 TUI 下被画面淹没、也不落盘。观察到的后果：error_audit 表
 * 0 条、gyccode.log 里搜不到任何 `[scope]` 错误行，**渲染异常长期无痕**
 * （本次侧栏/内联元素两处缺陷全靠 headless 复现才定位，就是栽在这个盲区）。
 *
 * TUI 侧落库不可行（无 DB），故退一步：把审计记录追加进 gyccode.log ——
 * 与 `core/observability/logging.ts` 的 fileLogger 同一文件、同一条 rotation
 * 链，保证错误事后可检索。写入失败一律吞掉：记错误绝不能成为新的故障源。
 */
import { appendFileSync } from "node:fs"
import path from "node:path"
import { Global } from "@core/global"
import { setErrorAuditSink } from "@core/observability/error-audit"

export function installTuiErrorAuditSink(file = path.join(Global.Path.log, "gyccode.log")): () => void {
  setErrorAuditSink((record) => {
    const session = record.sessionID ? ` session.id=${record.sessionID}` : ""
    const fields = record.fields ? ` fields=${JSON.stringify(record.fields)}` : ""
    const line = `timestamp=${new Date().toISOString()} level=Error run=tui scope=${record.scope}${session} message=${JSON.stringify(record.message)}${fields}\n`
    try {
      appendFileSync(file, line)
    } catch {
      // 审计写入失败不改变主流程
    }
  })
  return () => setErrorAuditSink(undefined)
}
