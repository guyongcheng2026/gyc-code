import { rename, unlink, stat } from "fs/promises"
import path from "path"

const LOCK_TIMEOUT = 5000
const LOCK_RETRY_INTERVAL = 100

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
        const tmpPath = `${this.lockPath}.tmp.${lockId}`
        const { writeFile } = await import("fs/promises")
        await writeFile(tmpPath, lockId, "utf-8")
        
        try {
          await rename(tmpPath, this.lockPath)
          this.acquired = true
          return true
        } catch (error: any) {
          if (error.code === "EEXIST") {
            await unlink(tmpPath).catch(() => {})
            await new Promise(resolve => setTimeout(resolve, LOCK_RETRY_INTERVAL))
            continue
          }
          await unlink(tmpPath).catch(() => {})
          throw error
        }
      } catch (error) {
        await new Promise(resolve => setTimeout(resolve, LOCK_RETRY_INTERVAL))
      }
    }

    return false
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
