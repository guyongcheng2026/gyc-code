import { afterAll, describe, expect, test } from "bun:test"
import { ensureRunning, isPortInUse, stop } from "./oauth-callback"

// 挑一个不常见的端口段，降低与机器上其他进程冲突的概率。
const PORT_A = 48124
const PORT_B = 48125
const uri = (port: number) => `http://127.0.0.1:${port}/mcp/oauth/callback`

/**
 * P2-3：`ensureRunning` 的 TOCTOU。
 *
 * 原文在 `const running = await isPortInUse(port)` 与 `server = createServer(...)`
 * 之间没有互斥：两个并发调用会双双判定「端口未占用」，于是各自 `createServer`。
 *
 * 这里刻意用**两个不同端口**验证 —— 同一个端口会撞上 EADDRINUSE，而
 * Windows 的 SO_REUSEADDR 语义又允许重复绑定，判据会变成平台相关。换成两个
 * 都能绑定成功的端口后，修复前的形态是确定的：先建的那个 server 被后来的
 * 赋值覆盖成孤儿，没人 close，端口一直占着到进程结束。
 */
describe("MCP 回调服务器 ensureRunning 并发安全", () => {
  afterAll(async () => {
    await stop()
  })

  test("并发切换端口不会遗留孤儿监听器", async () => {
    const results = await Promise.allSettled([ensureRunning(uri(PORT_A)), ensureRunning(uri(PORT_B))])
    expect(results.map((r) => r.status)).toEqual(["fulfilled", "fulfilled"])

    await stop()

    // 修复前 PORT_A 上的孤儿服务器无人 close，这里会是 true。
    expect(await isPortInUse(PORT_A)).toBe(false)
    expect(await isPortInUse(PORT_B)).toBe(false)
  })
})
