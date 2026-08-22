import path from "path"
import { appendFile, mkdir, open, readFile, rename, rm, writeFile } from "fs/promises"

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
  await rename(temporary, filePath).catch(async (error) => {
    await rm(temporary, { force: true }).catch(() => undefined)
    throw error
  })
}
