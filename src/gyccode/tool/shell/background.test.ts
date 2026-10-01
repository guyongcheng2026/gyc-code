import { describe, expect, test } from "bun:test"
import { readFile } from "node:fs/promises"
import * as Background from "./background"
import { resolve } from "./command"

const shell = process.platform === "win32" ? "powershell" : "/bin/bash"
const env = { ...process.env }

async function waitFor(
  fn: () => boolean,
  timeout = 10000,
) {
  const deadline = Date.now() + timeout
  while (Date.now() < deadline) {
    if (fn()) return true
    await Bun.sleep(50)
  }
  return false
}

describe("shell background", () => {
  test("resolve 对 PowerShell 走 -Command，其余交给系统 shell", () => {
    const spec = resolve("bash", "echo hi", "/tmp", env, false)
    if (process.platform === "win32") {
      expect(spec.useShell).toBe(true)
    } else {
      expect(spec.file).toBe("echo hi")
      expect(spec.useShell).toBe(true)
    }
  })

  test("后台任务写出日志并返回 shell_id", async () => {
    const job = Background.start({
      shell,
      command: "echo background-ok",
      cwd: process.cwd(),
      env,
    })
    expect(job.status).toBe("running")

    const done = await waitFor(() => Background.get(job.id)?.status !== "running")
    expect(done).toBe(true)

    const settled = Background.get(job.id)!
    expect(settled.status).toBe("exited")
    expect(settled.exitCode).toBe(0)

    const text = await readFile(job.outputPath, "utf-8")
    expect(text).toContain("background-ok")
  })

  test("进程结束后释放子进程句柄", async () => {
    const job = Background.start({
      shell,
      command: "echo handle-released",
      cwd: process.cwd(),
      env,
    })
    await waitFor(() => Background.get(job.id)?.status !== "running")
    // 句柄回收：已结束任务不应继续持有 ChildProcess，否则长会话会持续涨内存。
    expect(Background.get(job.id)?.child).toBeUndefined()
  })

  test("tail 返回末尾输出，超长时标注已省略", async () => {
    const job = Background.start({
      shell,
      command: "echo tail-marker-xyz",
      cwd: process.cwd(),
      env,
    })
    await waitFor(() => Background.get(job.id)?.status !== "running")

    const full = await Background.tail(job.id, 100000)
    expect(full?.text).toContain("tail-marker-xyz")

    const clipped = await Background.tail(job.id, 8)
    expect(clipped?.text.startsWith("...earlier output omitted...")).toBe(true)
  })

  test("tail 对未知 shell_id 返回 undefined", async () => {
    expect(await Background.tail("no-such-id", 100)).toBeUndefined()
  })

  test("kill 能结束运行中的任务，未知 id 返回 unknown", async () => {
    const job = Background.start({
      shell,
      command: process.platform === "win32" ? "Start-Sleep -Seconds 30" : "sleep 30",
      cwd: process.cwd(),
      env,
    })
    await Bun.sleep(300)

    const killed = Background.kill(job.id)
    expect(killed.ok).toBe(true)

    const gone = await waitFor(() => Background.get(job.id)?.status !== "running")
    expect(gone).toBe(true)

    expect(Background.kill("no-such-id")).toEqual({ ok: false, reason: "unknown" })
  })

  test("kill 已结束的任务返回 finished", async () => {
    const job = Background.start({
      shell,
      command: "echo already-done",
      cwd: process.cwd(),
      env,
    })
    await waitFor(() => Background.get(job.id)?.status !== "running")
    expect(Background.kill(job.id)).toEqual({ ok: false, reason: "finished" })
  })

  test("list 能列出后台任务", async () => {
    const before = Background.list().length
    const job = Background.start({
      shell,
      command: "echo listed",
      cwd: process.cwd(),
      env,
    })
    const after = Background.list()
    expect(after.length).toBeGreaterThanOrEqual(before + 1)
    expect(after.some((item) => item.id === job.id)).toBe(true)
  })

  test("sweep 只回收已结束任务，不丢弃运行中任务的句柄", () => {
    const running = Background.start({
      shell,
      command: process.platform === "win32" ? "Start-Sleep -Seconds 5" : "sleep 5",
      cwd: process.cwd(),
      env,
    })
    try {
      // 传入极小的 TTL：已结束任务必然过期，运行中的任务必须留下，
      // 否则该进程将永远无法被 kill。
      Background.sweep(Date.now() + 60 * 60 * 1000)
      expect(Background.get(running.id)?.status).toBe("running")
    } finally {
      Background.kill(running.id)
    }
  })
})