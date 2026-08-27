import path from "path"
import { appendFile, mkdir, open, readFile, rename, rm, writeFile } from "fs/promises"
import { Path } from "@gyccode/core/global"

export async function readText(filePath: string) {
  return readFile(filePath, "utf8")
}

export async function readJson<T>(filePath: string) {
  return JSON.parse(await readFile(filePath, "utf8")) as T
}

export async function writeText(filePath: string, content: string) {
  await mkdir(path.dirname(filePath), { recursive: true })
  await writeFile(filePath, content)
}

export async function appendText(filePath: string, content: string) {
  await mkdir(path.dirname(filePath), { recursive: true })
  await appendFile(filePath, content)
}

// Windows 上 rename 的目标文件被杀毒软件/并发读句柄瞬时锁定时抛
// EPERM/EBUSY/EACCES/ENOTEMPTY，属瞬时错误：短暂退避重试即可成功。
// 2026-08-27 实证：model.json 的 EPERM rename 失败曾以 unhandledRejection
// 击穿 TUI 主进程（降级安全模式退出），必须在此层吸收。
const TRANSIENT_RENAME_ERRORS = new Set(["EPERM", "EBUSY", "EACCES", "ENOTEMPTY"])
const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms))

export async function writeJsonAtomic(filePath: string, value: unknown) {
  await mkdir(path.dirname(filePath), { recursive: true })
  const temporary = `${filePath}.${process.pid}.${crypto.randomUUID()}.tmp`
  // rename 保证原子性但不保证数据已落盘：掉电时可能留下空文件/截断 JSON，
  // 下次读取 JSON.parse 直接抛错。写入后、rename 前先 fsync 临时文件。
  const handle = await open(temporary, "w")
  try {
    await handle.writeFile(JSON.stringify(value))
    await handle.sync()
  } catch (error) {
    await handle.close().catch(() => undefined)
    await rm(temporary, { force: true }).catch(() => undefined)
    throw error
  }
  await handle.close()
  // 瞬时占用重试：100/200/400ms 三次退避
  for (let attempt = 0; ; attempt++) {
    try {
      await rename(temporary, filePath)
      return
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code ?? ""
      if (attempt >= 2 || !TRANSIENT_RENAME_ERRORS.has(code)) {
        await rm(temporary, { force: true }).catch(() => undefined)
        throw error
      }
      await sleep(100 * 2 ** attempt)
    }
  }
}

/**
 * 偏好类状态写入：失败不向调用方传播（void 调用场景下避免升级为
 * unhandledRejection 击穿 TUI），仅写 gyccode.log 留证。数据仍在内存
 * store 中，下次状态变化会重写。
 */
export async function writeJsonAtomicLogged(filePath: string, value: unknown, label: string) {
  try {
    await writeJsonAtomic(filePath, value)
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    try {
      await appendFile(
        path.join(Path.log, "gyccode.log"),
        `timestamp=${new Date().toISOString()} level=Warn run=main persistence-write-failed label=${label} file=${filePath} message=${JSON.stringify(message)}\n`,
      )
    } catch {}
  }
}
