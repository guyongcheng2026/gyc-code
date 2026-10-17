import { beforeEach, describe, expect, setDefaultTimeout, test } from "bun:test"
import { existsSync, mkdirSync, mkdtempSync, unlinkSync, writeFileSync } from "node:fs"
import { homedir } from "node:os"
import { join } from "node:path"
import { releaseLock, recoverStaleLock, tryAcquireLock } from "./gateway"

// 真起子进程（锁与守护进程语义）。2026-10-16 压力测试：并发负载下此类用例
// 多次触及 bun 默认 5s 上限而误报，统一放宽用例预算（不改断言）。
setDefaultTimeout(30_000)

const lockFile = () => join(homedir(), ".gyc", "data", "weixin", "gateway.lock")
const heartbeatFile = () => join(homedir(), ".gyc", "data", "weixin", "heartbeat.json")

let tempHome: string
const realHome = homedir()

describe("gateway 锁生命周期", () => {
  beforeEach(() => {
    tempHome = mkdtempSync(join(realHome, ".tmp-gateway-test-"))
    process.env.USERPROFILE = tempHome
    mkdirSync(join(tempHome, ".gyc", "data", "weixin"), { recursive: true })
  })

  test("拿锁后释放应删除锁文件，且可再次拿锁", () => {
    const fd = tryAcquireLock()
    expect(fd).not.toBeNull()
    expect(existsSync(lockFile())).toBe(true)
    releaseLock(fd)
    expect(existsSync(lockFile())).toBe(false)
    expect(tryAcquireLock()).not.toBeNull()
  })

  test("无心跳时 recoverStaleLock 清理残留锁并返回 true", () => {
    writeFileSync(lockFile(), "")
    expect(recoverStaleLock()).toBe(true)
    expect(existsSync(lockFile())).toBe(false)
  })

  test("心跳指向存活的其他进程时不清理残留锁", async () => {
    writeFileSync(lockFile(), "")
    const proc = Bun.spawn(["cmd", "/c", "timeout", "/t", "10"], { stdout: "ignore", stderr: "ignore" })
    try {
      writeFileSync(heartbeatFile(), JSON.stringify({ pid: proc.pid }))
      expect(recoverStaleLock()).toBe(false)
      expect(existsSync(lockFile())).toBe(true)
    } finally {
      proc.kill()
      await proc.exited
      try { unlinkSync(heartbeatFile()) } catch {}
    }
  })
})
