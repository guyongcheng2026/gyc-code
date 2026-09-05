import { unlink } from "fs/promises"

const LOCK_TIMEOUT = 5000
const LOCK_RETRY_INTERVAL = 100
// 锁文件若早于该时长未被更新，视为持有者已崩溃/被杀遗留的陈旧锁
const LOCK_STALE_MS = 30_000

export class FileLock {
  private lockPath: string
  private acquired = false

  constructor(filePath: string) {
    this.lockPath = `${filePath}.lock`
  }

  async acquire(): Promise<boolean> {
    const startTime = Date.now()
    const lockId = `${process.pid}-${Date.now()}-${Math.random().toString(36).slice(2)}`

    while (Date.now() - startTime < LOCK_TIMEOUT) {
      try {
        const { writeFile } = await import("fs/promises")
        // flag:"wx" = O_CREAT|O_EXCL：目标已存在时原子返回 EEXIST。
        // 这是跨平台真正的排他建锁（POSIX/Windows 的 rename 会原子覆盖目标、永不会抛 EEXIST，
        // 旧实现因此完全不具备互斥性）。
        await writeFile(this.lockPath, lockId, { encoding: "utf-8", flag: "wx" })
        this.acquired = true
        return true
      } catch (error: any) {
        if (error?.code === "EEXIST") {
          // 被占用：先清理可能存在的陈旧锁（持有者崩溃/被杀遗留），再等一拍重试
          await this.clearIfStale()
          await new Promise(resolve => setTimeout(resolve, LOCK_RETRY_INTERVAL))
          continue
        }
        await new Promise(resolve => setTimeout(resolve, LOCK_RETRY_INTERVAL))
      }
    }

    return false
  }

  /** 锁文件已陈旧（mtime 早于 LOCK_STALE_MS）则删除，避免崩溃遗留导致永久死锁 */
  private async clearIfStale(): Promise<void> {
    try {
      const { stat } = await import("fs/promises")
      const st = await stat(this.lockPath)
      if (Date.now() - st.mtimeMs > LOCK_STALE_MS) {
        await unlink(this.lockPath).catch(() => {})
      }
    } catch {
      // stat 失败（如锁刚被删除）→ 无需清理
    }
  }

  async release(): Promise<void> {
    if (this.acquired) {
      await unlink(this.lockPath).catch(() => {})
      this.acquired = false
    }
  }

  async withLock<T>(fn: () => Promise<T>): Promise<T> {
    const acquired = await this.acquire()
    if (!acquired) {
      throw new Error(`Failed to acquire lock on ${this.lockPath}`)
    }
    try {
      return await fn()
    } finally {
      await this.release()
    }
  }
}

export function createFileLock(filePath: string): FileLock {
  return new FileLock(filePath)
}
