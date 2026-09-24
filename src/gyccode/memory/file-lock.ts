import { mkdir, unlink } from "fs/promises"
import path from "path"

const LOCK_TIMEOUT = 5000
const LOCK_RETRY_BASE_INTERVAL = 50
const LOCK_MAX_RETRY_INTERVAL = 500
const LOCK_MAX_RETRIES = 50
// 锁文件若早于该时长未被更新，视为持有者已崩溃/被杀遗留的陈旧锁
const LOCK_STALE_MS = 30_000

export class LockAcquisitionFailed extends Error {
  constructor(public readonly lockPath: string, public readonly attempts: number, public readonly elapsedMs: number) {
    super(`Failed to acquire lock on ${lockPath} after ${attempts} attempts (${elapsedMs}ms)`)
    this.name = "LockAcquisitionFailed"
  }
}

export interface FileLockOptions {
  staleMs?: number
  timeoutMs?: number
  baseRetryIntervalMs?: number
  maxRetryIntervalMs?: number
  maxRetries?: number
}

export class FileLock {
  private lockPath: string
  private acquired = false
  private readonly options: Required<FileLockOptions>

  constructor(filePath: string, options: FileLockOptions = {}) {
    this.lockPath = `${filePath}.lock`
    this.options = {
      staleMs: options.staleMs ?? LOCK_STALE_MS,
      timeoutMs: options.timeoutMs ?? LOCK_TIMEOUT,
      baseRetryIntervalMs: options.baseRetryIntervalMs ?? LOCK_RETRY_BASE_INTERVAL,
      maxRetryIntervalMs: options.maxRetryIntervalMs ?? LOCK_MAX_RETRY_INTERVAL,
      maxRetries: options.maxRetries ?? LOCK_MAX_RETRIES,
    }
  }

  async acquire(): Promise<void> {
    const startTime = Date.now()
    const lockId = `${process.pid}-${Date.now()}-${Math.random().toString(36).slice(2)}`
    let attempts = 0
    let retryInterval = this.options.baseRetryIntervalMs

    while (Date.now() - startTime < this.options.timeoutMs && attempts < this.options.maxRetries) {
      try {
        const { writeFile } = await import("fs/promises")
        // flag:"wx" = O_CREAT|O_EXCL：目标已存在时原子返回 EEXIST
        // 这是跨平台真正的排他建锁（POSIX/Windows 的 rename 会原子覆盖目标、永不会返回 EEXIST）
        // 旧实现因此完全不具备互斥性
        await writeFile(this.lockPath, lockId, { encoding: "utf-8", flag: "wx" })
        this.acquired = true
        return
      } catch (error: any) {
        attempts++
        if (error?.code === "EEXIST") {
          // 被占用：先清理可能存在的陈旧锁（持有者崩溃/被杀遗留），再指数退避重试
          await this.clearIfStale()
        } else if (error?.code === "ENOENT") {
          // 锁文件父目录尚不存在（调用方普遍在锁内才 mkdir 目标目录）：
          // 先补建父目录再重试，否则会在这里空转到超时
          await mkdir(path.dirname(this.lockPath), { recursive: true }).catch(() => {})
        }
        // 指数退避 + jitter
        const jitter = Math.random() * retryInterval * 0.5
        await new Promise(resolve => setTimeout(resolve, retryInterval + jitter))
        retryInterval = Math.min(retryInterval * 1.5, this.options.maxRetryIntervalMs)
      }
    }

    const elapsed = Date.now() - startTime
    throw new LockAcquisitionFailed(this.lockPath, attempts, elapsed)
  }

  /** 锁文件已陈旧（mtime 早于 staleMs）则删除，避免崩溃遗留导致永久死锁 */
  private async clearIfStale(): Promise<void> {
    try {
      const { stat } = await import("fs/promises")
      const st = await stat(this.lockPath)
      if (Date.now() - st.mtimeMs > this.options.staleMs) {
        await unlink(this.lockPath).catch(() => {})
      }
    } catch {
      // stat 失败（如锁刚被删除）无需清理
    }
  }

  async release(): Promise<void> {
    if (this.acquired) {
      await unlink(this.lockPath).catch(() => {})
      this.acquired = false
    }
  }

  async withLock<T>(fn: () => Promise<T>): Promise<T> {
    await this.acquire()
    try {
      return await fn()
    } finally {
      await this.release()
    }
  }
}

export function createFileLock(filePath: string, options?: FileLockOptions): FileLock {
  return new FileLock(filePath, options)
}