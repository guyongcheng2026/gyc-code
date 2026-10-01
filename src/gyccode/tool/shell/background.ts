import { spawn, type ChildProcess } from "node:child_process"
import { randomUUID } from "node:crypto"
import { closeSync, mkdirSync, openSync } from "node:fs"
import { open, stat } from "node:fs/promises"
import * as path from "node:path"
import { Global } from "@gyccode/core/global"
import { resolve } from "./command"

export type BackgroundStatus = "running" | "exited" | "killed"

export type BackgroundJob = {
  id: string
  command: string
  cwd: string
  outputPath: string
  startedAt: number
  status: BackgroundStatus
  exitCode: number | null
  signal: NodeJS.Signals | null
  /**
   * 运行期持有子进程句柄用于 kill；进程结束后立刻置空，
   * 这样已结束的任务不会把 ChildProcess 一直留在内存里。
   */
  child: ChildProcess | undefined
}

/** 已结束任务的保留时长，超时后连同输出路径一起回收。 */
const FINISHED_TTL = 30 * 60 * 1000
/** 同时保留的任务条数上限，优先淘汰已结束的。 */
const RETAIN_LIMIT = 32

const jobs = new Map<string, BackgroundJob>()

function dir() {
  const target = path.join(Global.Path.tmp, "gyccode", "shell")
  mkdirSync(target, { recursive: true })
  return target
}

/**
 * 回收后台任务句柄。已结束的按 TTL 清理；超出条数上限时只淘汰已结束的，
 * 绝不丢弃仍在运行的任务句柄——否则那个进程将永远无法被 kill。
 */
export function sweep(now = Date.now()) {
  for (const [id, job] of jobs) {
    if (job.status !== "running" && now - job.startedAt > FINISHED_TTL) jobs.delete(id)
  }
  if (jobs.size <= RETAIN_LIMIT) return
  const finished = [...jobs.values()].filter((job) => job.status !== "running")
  for (const job of finished) {
    if (jobs.size <= RETAIN_LIMIT) break
    jobs.delete(job.id)
  }
}

export function start(input: {
  shell: string
  command: string
  cwd: string
  env: NodeJS.ProcessEnv
}) {
  sweep()
  const id = randomUUID()
  const outputPath = path.join(dir(), `${id}.log`)
  // Windows 上 PowerShell 遇 DETACHED_PROCESS 会直接退出且不吐任何输出
  // （已实测：exit 0，日志为空），因此与前台路径保持一致，win32 不设 detached。
  const detached = process.platform !== "win32"
  const spec = resolve(input.shell, input.command, input.cwd, input.env, detached)

  // 直接把文件描述符交给子进程：既省掉 stdout/stderr 管道与写流，
  // 也让 unref() 真正生效——CLI 因此不必等后台进程结束就能退出。
  const fd = openSync(outputPath, "a")
  let child: ChildProcess
  try {
    child = spawn(spec.file, spec.args, {
      cwd: spec.options.cwd,
      env: spec.options.env,
      shell: spec.useShell ? input.shell : undefined,
      detached,
      stdio: ["ignore", fd, fd],
      windowsHide: true,
    })
  } finally {
    closeSync(fd)
  }

  const job: BackgroundJob = {
    id,
    command: input.command,
    cwd: input.cwd,
    outputPath,
    startedAt: Date.now(),
    status: "running",
    exitCode: null,
    signal: null,
    child,
  }
  jobs.set(id, job)

  child.on("error", () => {
    // 启动失败（命令不存在等）也会走这里，统一收敛成已结束状态。
    job.status = "exited"
    job.child = undefined
  })
  child.on("exit", (code, signal) => {
    job.exitCode = code
    job.signal = signal
    job.status = signal ? "killed" : "exited"
    job.child = undefined
  })
  child.unref()

  return job
}

export function get(id: string) {
  sweep()
  return jobs.get(id)
}

export function list() {
  sweep()
  return [...jobs.values()]
}

export function kill(id: string): { ok: true } | { ok: false; reason: "unknown" | "finished" } {
  sweep()
  const job = jobs.get(id)
  if (!job) return { ok: false, reason: "unknown" }
  const pid = job.child?.pid
  if (!job.child || job.status !== "running" || pid === undefined) {
    return { ok: false, reason: "finished" }
  }

  if (process.platform === "win32") {
    // /T 连同子进程树一起结束，避免只杀掉最外层 shell 留下孤儿。
    spawn("taskkill", ["/PID", String(pid), "/T", "/F"], {
      stdio: "ignore",
      windowsHide: true,
    }).unref()
  } else {
    try {
      process.kill(-pid, "SIGTERM")
    } catch {
      try {
        process.kill(pid, "SIGTERM")
      } catch {
        return { ok: false, reason: "finished" }
      }
    }
  }
  return { ok: true }
}

export async function tail(id: string, maxBytes: number) {
  const job = get(id)
  if (!job) return undefined
  const info = await stat(job.outputPath).catch(() => undefined)
  if (!info || info.size === 0) return { job, text: "(no output)" }
  const start = Math.max(0, info.size - maxBytes)
  const handle = await open(job.outputPath, "r")
  try {
    const buffer = Buffer.alloc(info.size - start)
    await handle.read(buffer, 0, buffer.length, start)
    const text = buffer.toString("utf-8")
    return { job, text: start > 0 ? "...earlier output omitted...\n" + text : text }
  } finally {
    await handle.close()
  }
}