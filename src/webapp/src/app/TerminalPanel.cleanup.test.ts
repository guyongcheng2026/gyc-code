import { readFileSync } from "node:fs"
import { resolve } from "node:path"
import { describe, expect, it } from "vitest"

// P2-17：终端面板此前没有任何卸载清理。xterm 实例与每路 PTY 的 WebSocket 都是
// 组件私有引用（termRef / ptys state），组件一卸载就再也拿不到，只有用户手点
// 「关闭」才会 disconnect —— 切页、关标签、切工作区全都整片漏掉。
//
// 这里用源码断言而非渲染测试：组件级行为测试需要 mock @xterm/xterm 与
// WebSocket，成本高于这条回归护栏能挡住的收益。
// 路径走 cwd：vitest 的 import.meta.url 不是 file 协议（会报
// "The URL must be of scheme file"）。
const source = readFileSync(resolve(process.cwd(), "src/webapp/src/app/TerminalPanel.tsx"), "utf8")

describe("TerminalPanel 卸载清理", () => {
  it("清理中释放 xterm 实例", () => {
    expect(source).toContain("termRef.current?.dispose()")
  })

  it("清理中断开全部 PTY 连接", () => {
    expect(source).toContain("p.conn.disconnect()")
  })

  it("清理中回收服务端 PTY，不只断 WebSocket", () => {
    // 只断 WS 会留下服务端的 shell 进程。webapp 未启用 StrictMode（main.tsx 直接
    // 渲染 <App />），不存在双挂载误杀，所以卸载时可以安全地连服务端一起收掉。
    expect(source).toContain("void remove(p.id)")
  })
})
