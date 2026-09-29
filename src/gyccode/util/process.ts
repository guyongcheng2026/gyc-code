import { type ChildProcess } from "child_process"
import type { Stream } from "node:stream"
import launch from "cross-spawn"
import { buffer } from "node:stream/consumers"
import { errorMessage } from "./error"

export type Stdio = "inherit" | "pipe" | "ignore" | number | Stream
export type Shell = boolean | string

export interface Options {
  cwd?: string
  env?: NodeJS.ProcessEnv | null
  stdin?: Stdio
  stdout?: Stdio
  stderr?: Stdio
  shell?: Shell
  abort?: AbortSignal
  kill?: NodeJS.Signals | number
  timeout?: number
}

export interface RunOptions extends Omit<Options, "stdout" | "stderr"> {
  nothrow?: boolean
  /** Maximum buffer size in bytes for stdout/stderr. Default 10MB. */
  maxBuffer?: number
}

export interface Result {
  code: number
  stdout: Buffer
  stderr: Buffer
}

export interface TextResult extends Result {
  text: string
}

export class RunFailedError extends Error {
  readonly cmd: string[]
  readonly code: number
  readonly stdout: Buffer
  readonly stderr: Buffer

  constructor(cmd: string[], code: number, stdout: Buffer, stderr: Buffer) {
    const text = stderr.toString().trim()
    super(
      text
        ? `Command failed with code ${code}: ${cmd.join(" ")}\n${text}`
        : `Command failed with code ${code}: ${cmd.join(" ")}`,
    )
    this.name = "ProcessRunFailedError"
    this.cmd = [...cmd]
    this.code = code
    this.stdout = stdout
    this.stderr = stderr
  }
}

export type Child = ChildProcess & { exited: Promise<number> }

export function spawn(cmd: string[], opts: Options = {}): Child {
  if (cmd.length === 0) throw new Error("Command is required")
  const command = cmd[0]
  if (command === undefined) throw new Error("Command is required")
  opts.abort?.throwIfAborted()

  const proc = launch(command, cmd.slice(1), {
    cwd: opts.cwd,
    shell: opts.shell,
    env: opts.env === null ? {} : opts.env ? { ...process.env, ...opts.env } : undefined,
    stdio: [opts.stdin ?? "ignore", opts.stdout ?? "ignore", opts.stderr ?? "ignore"],
    windowsHide: process.platform === "win32",
  })

  let closed = false
  let timer: ReturnType<typeof setTimeout> | undefined

  const abort = () => {
    if (closed) return
    if (proc.exitCode !== null || proc.signalCode !== null) return
    closed = true

    proc.kill(opts.kill ?? "SIGTERM")

    const ms = opts.timeout ?? 5_000
    if (ms <= 0) return
    timer = setTimeout(() => proc.kill("SIGKILL"), ms)
  }

  const exited = new Promise<number>((resolve, reject) => {
    const done = () => {
      opts.abort?.removeEventListener("abort", abort)
      if (timer) clearTimeout(timer)
    }

    proc.once("exit", (code, signal) => {
      done()
      resolve(code ?? (signal ? 1 : 0))
    })

    proc.once("error", (error) => {
      done()
      reject(error)
    })
  })
  void exited.catch(() => undefined)

  if (opts.abort) {
    opts.abort.addEventListener("abort", abort, { once: true })
    if (opts.abort.aborted) abort()
  }

  const child = proc as Child
  child.exited = exited
  return child
}

// NodeJS.ReadableStream 上没有 destroy 声明，窄化后调用以关闭读端
function destroyStream(stream: NodeJS.ReadableStream): void {
  const target = stream as { destroy?: (error?: Error) => unknown }
  if (typeof target.destroy === "function") target.destroy()
}

// SIGTERM 后多久升级为 SIGKILL
const FORCE_KILL_DELAY_MS = 3_000

// Helper to consume stream with max buffer limit
// 超过 maxBytes 后截断返回，并关闭读端 + 终止子进程：
// 只 return 不销毁流，stdout 管道写满后子进程永久阻塞，proc.exited 永不 resolve，run() 挂起成僵尸进程。
async function limitedBuffer(
  stream: NodeJS.ReadableStream,
  maxBytes: number,
  onTruncate: () => void,
): Promise<Buffer> {
  const chunks: Buffer[] = []
  let total = 0
  for await (const chunk of stream) {
    const buf = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)
    total += buf.length
    if (total > maxBytes) {
      // 按实际长度切片：按 maxBytes 补齐会插入 NUL 垃圾，且触发截断的当前块未计入
      const truncated = Buffer.concat(chunks).subarray(0, maxBytes)
      const indicator = Buffer.from(`\n...[truncated ${total - truncated.length} bytes]...`)
      destroyStream(stream)
      onTruncate()
      return Buffer.concat([truncated, indicator])
    }
    chunks.push(buf)
  }
  return Buffer.concat(chunks)
}

export async function run(cmd: string[], opts: RunOptions = {}): Promise<Result> {
  const proc = spawn(cmd, {
    cwd: opts.cwd,
    env: opts.env,
    stdin: opts.stdin,
    shell: opts.shell,
    abort: opts.abort,
    kill: opts.kill,
    timeout: opts.timeout,
    stdout: "pipe",
    stderr: "pipe",
  })

  if (!proc.stdout || !proc.stderr) throw new Error("Process output not available")

  const maxBuffer = opts.maxBuffer ?? 10 * 1024 * 1024 // 10MB default

  // 截断后子进程可能已阻塞在写管道上，必须主动终止，Promise 侧才能等到 exit 而不永久挂起。
  // SIGTERM 只在 POSIX 有意义：子进程可以捕获/忽略它，Windows 上 Bun 的 SIGTERM 也可能
  // 映射失败。故 SIGTERM 后启动升级定时器，到期仍未退出就 SIGKILL 强杀，
  // 否则 proc.exited 永不 resolve，run() 挂成僵尸。
  let forceKillTimer: ReturnType<typeof setTimeout> | undefined
  const onTruncate = () => {
    if (proc.exitCode !== null || proc.signalCode !== null) return
    proc.kill("SIGTERM")
    if (forceKillTimer !== undefined) return
    forceKillTimer = setTimeout(() => {
      if (proc.exitCode === null && proc.signalCode === null) proc.kill("SIGKILL")
    }, FORCE_KILL_DELAY_MS)
    if (typeof forceKillTimer === "object" && "unref" in forceKillTimer) {
      ;(forceKillTimer as { unref: () => void }).unref()
    }
  }

  const out = await Promise.all([
    proc.exited,
    limitedBuffer(proc.stdout, maxBuffer, onTruncate),
    limitedBuffer(proc.stderr, maxBuffer, onTruncate),
  ])
    .then(([code, stdout, stderr]) => {
      if (forceKillTimer !== undefined) clearTimeout(forceKillTimer)
      return {
        code,
        stdout,
        stderr,
      }
    })
    .catch((err: unknown) => {
      if (forceKillTimer !== undefined) clearTimeout(forceKillTimer)
      if (!opts.nothrow) throw err
      return {
        code: 1,
        stdout: Buffer.alloc(0),
        stderr: Buffer.from(errorMessage(err)),
      }
    })
  if (out.code === 0 || opts.nothrow) return out
  throw new RunFailedError(cmd, out.code, out.stdout, out.stderr)
}

// Duplicated in `packages/sdk/js/src/process.ts` because the SDK cannot import
// `gyccode` without creating a cycle. Keep both copies in sync.
export async function stop(proc: ChildProcess) {
  if (proc.exitCode !== null || proc.signalCode !== null) return

  if (process.platform !== "win32" || !proc.pid) {
    proc.kill()
    return
  }

  const out = await run(["taskkill", "/pid", String(proc.pid), "/T", "/F"], {
    nothrow: true,
  })

  if (out.code === 0) return
  proc.kill()
}

export async function text(cmd: string[], opts: RunOptions = {}): Promise<TextResult> {
  const out = await run(cmd, opts)
  return {
    ...out,
    text: out.stdout.toString(),
  }
}

export async function lines(cmd: string[], opts: RunOptions = {}): Promise<string[]> {
  return (await text(cmd, opts)).text.split(/\r?\n/).filter(Boolean)
}

export * as Process from "./process"