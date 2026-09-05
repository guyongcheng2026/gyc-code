import { chmod, mkdir, readFile, readdir, stat as statFile, writeFile, access } from "fs/promises"
import { stripBom } from "@gyccode/core/util/text-encoding"
import { createWriteStream, readdirSync, statSync } from "fs"
import { dirname, isAbsolute, join, resolve as pathResolve } from "path"
import { Readable } from "stream"
import { pipeline } from "stream/promises"
import { Glob } from "@gyccode/core/util/glob"
import { FSUtil } from "@gyccode/core/fs-util"
import { fileURLToPath } from "url"

// Async version for non-blocking checks
export async function exists(p: string): Promise<boolean> {
  try {
    await access(p)
    return true
  } catch {
    return false
  }
}

export async function isDir(p: string): Promise<boolean> {
  try {
    const s = await statFile(p)
    return s.isDirectory()
  } catch {
    return false
  }
}

export function stat(p: string): ReturnType<typeof statSync> | undefined {
  return statSync(p, { throwIfNoEntry: false }) ?? undefined
}

export async function statAsync(p: string): Promise<ReturnType<typeof statSync> | undefined> {
  return statFile(p).catch((e) => {
    if (isEnoent(e)) return undefined
    throw e
  })
}

export async function size(p: string): Promise<number> {
  const s = stat(p)?.size ?? 0
  return typeof s === "bigint" ? Number(s) : s
}

export async function readText(p: string): Promise<string> {
  return readFile(p, "utf-8")
}

export async function readJson<T = unknown>(p: string): Promise<T> {
  return JSON.parse(stripBom(await readFile(p, "utf-8")))
}

export async function readBytes(p: string): Promise<Buffer> {
  return readFile(p)
}

export interface DirectoryEntry {
  name: string
  isDirectory: boolean
  isFile: boolean
  isSymbolicLink: boolean
  path: string
}

/**
 * 列出目录条目（异步）。不存在的目录返回空数组而非抛错。
 */
export async function list(p: string): Promise<DirectoryEntry[]> {
  try {
    const dirents = await readdir(p, { withFileTypes: true })
    return dirents.map(d => ({
      name: d.name,
      isDirectory: d.isDirectory(),
      isFile: d.isFile(),
      isSymbolicLink: d.isSymbolicLink(),
      path: pathResolve(p, d.name),
    }))
  } catch {
    return []
  }
}

/**
 * 列出目录条目（同步）。不存在的目录返回空数组而非抛错。
 */
export function listSync(p: string): DirectoryEntry[] {
  try {
    const dirents = readdirSync(p, { withFileTypes: true })
    return dirents.map(d => ({
      name: d.name,
      isDirectory: d.isDirectory(),
      isFile: d.isFile(),
      isSymbolicLink: d.isSymbolicLink(),
      path: pathResolve(p, d.name),
    }))
  } catch {
    return []
  }
}

export async function readArrayBuffer(p: string): Promise<ArrayBuffer> {
  const buf = await readFile(p)
  return buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength) as ArrayBuffer
}

function isEnoent(e: unknown): e is { code: "ENOENT" } {
  return typeof e === "object" && e !== null && "code" in e && (e as { code: string }).code === "ENOENT"
}

export async function write(p: string, content: string | Buffer | Uint8Array, mode?: number): Promise<void> {
  try {
    if (mode) {
      await writeFile(p, content, { mode })
    } else {
      await writeFile(p, content)
    }
  } catch (e) {
    if (isEnoent(e)) {
      await mkdir(dirname(p), { recursive: true })
      if (mode) {
        await writeFile(p, content, { mode })
      } else {
        await writeFile(p, content)
      }
      return
    }
    throw e
  }
}

export async function writeJson(p: string, data: unknown, mode?: number): Promise<void> {
  return write(p, JSON.stringify(data, null, 2), mode)
}

export async function writeStream(
  p: string,
  stream: ReadableStream<Uint8Array> | Readable,
  mode?: number,
): Promise<void> {
  const dir = dirname(p)
  if (!(await exists(dir))) {
    await mkdir(dir, { recursive: true })
  }

  const nodeStream = stream instanceof ReadableStream ? Readable.fromWeb(stream as any) : stream
  const writeStream = createWriteStream(p)
  await pipeline(nodeStream, writeStream)

  if (mode) {
    await chmod(p, mode)
  }
}

export async function mimeType(p: string): Promise<string> {
  const { lookup } = await import("mime-types")
  return lookup(p) || "application/octet-stream"
}

/**
 * On Windows, normalize a path to its canonical casing using the filesystem.
 * This is needed because Windows paths are case-insensitive but LSP servers
 * may return paths with different casing than what we send them.
 */
export function normalizePath(p: string): string {
  return FSUtil.normalizePath(p)
}

export function normalizePathPattern(p: string): string {
  return FSUtil.normalizePathPattern(p)
}

// We cannot rely on path.resolve() here because git.exe may come from Git Bash, Cygwin, or MSYS2, so we need to translate these paths at the boundary.
// Also resolves symlinks so that callers using the result as a cache key
// always get the same canonical path for a given physical directory.
export function resolve(p: string): string {
  return FSUtil.resolve(p)
}

export function resolveFilePath(root: string, file: string): string {
  const raw = file.startsWith("file://") ? fileURLToPath(file) : file
  if (isAbsolute(raw)) return raw
  return pathResolve(root, raw)
}

export function windowsPath(p: string): string {
  return FSUtil.windowsPath(p)
}
export function overlaps(a: string, b: string) {
  return FSUtil.overlaps(a, b)
}

export function contains(parent: string, child: string) {
  return FSUtil.contains(parent, child)
}

export async function findUp(
  target: string,
  start: string,
  stop?: string,
  options?: { rootFirst?: boolean },
): Promise<string[]>
export async function findUp(
  target: string[],
  start: string,
  stop?: string,
  options?: { rootFirst?: boolean },
): Promise<string[]>
export async function findUp(
  target: string | string[],
  start: string,
  stop?: string,
  options?: { rootFirst?: boolean },
) {
  const dirs = [start]
  let current = start
  while (true) {
    if (stop === current) break
    const parent = dirname(current)
    if (parent === current) break
    dirs.push(parent)
    current = parent
  }

  const targets = Array.isArray(target) ? target : [target]
  const result = []
  for (const dir of options?.rootFirst ? dirs.toReversed() : dirs) {
    for (const item of targets) {
      const search = join(dir, item)
      if (await exists(search)) result.push(search)
    }
  }
  return result
}

export async function* up(options: { targets: string[]; start: string; stop?: string }) {
  const { targets, start, stop } = options
  let current = start
  while (true) {
    for (const target of targets) {
      const search = join(current, target)
      if (await exists(search)) yield search
    }
    if (stop === current) break
    const parent = dirname(current)
    if (parent === current) break
    current = parent
  }
}

export async function globUp(pattern: string, start: string, stop?: string) {
  let current = start
  const result = []
  while (true) {
    try {
      const matches = await Glob.scan(pattern, {
        cwd: current,
        absolute: true,
        include: "file",
        dot: true,
      })
      result.push(...matches)
    } catch {
      // Skip invalid glob patterns
    }
    if (stop === current) break
    const parent = dirname(current)
    if (parent === current) break
    current = parent
  }
  return result
}

export * as Filesystem from "./filesystem"
