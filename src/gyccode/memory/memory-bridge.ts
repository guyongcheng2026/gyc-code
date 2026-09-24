// Memory bridge — gyc-cli 跨会话记忆文件读写（双向同步）
// Based on @yunguang/memory UnifiedMemoryManager

import { mkdir, readFile, rename, rm, stat, writeFile } from "fs/promises"
import path from "path"
import { homedir } from "os"
import { createFileLock } from "./file-lock"

// 缓存一致性：读操作可并发；写入（invalidateMemoryCache）递增代际计数，
// 使在飞行中的读不再回写快照，避免"写后读到写前内容"（见 readMemoriesCached）。
// P1 修复：跨会话记忆按项目隔离
// 基于 process.cwd() 生成项目隔离路径，避免不同项目记忆相互污染
export function getMemoryDir(): string {
  const base = process.env.GYCCODE_MEMORY_HOME || process.env.HERMES_HOME || path.join(homedir(), ".gyc")
  const memDir = path.join(base, "memory")
  const projectKey = getProjectKey()
  return path.join(memDir, projectKey)
}

export function getProjectKey(): string {
  const cwd = process.cwd()
  const parts = cwd.replace(/\\/g, "/").split("/").filter(Boolean)
  const name = parts[parts.length - 1] || "default"
  return name.replace(/[^a-zA-Z0-9_-]/g, "_")
}

// Lazy getters to avoid module-level dependency on process.cwd()
// which can change during tests or multi-project scenarios.
const getMemDir = () => getMemoryDir()
const getLegacyDir = () => path.join(
  process.env.GYCCODE_MEMORY_HOME || process.env.HERMES_HOME || path.join(homedir(), ".gyc"),
  "memory",
)

const getMemoryPath = () => path.join(getMemDir(), "gyccode_memory.md")

// 兼容旧文件名：读取时新文件缺失则回退旧文件，写入始终写新名
const getLegacyMemoryPath = () => path.join(getLegacyDir(), "hermes_gyccode_memory.md")
// 项目隔离前 gyc 写的是 memory/gyccode_memory.md，须继续兼容读取
const getPreProjectMemoryPath = () => path.join(getLegacyDir(), "gyccode_memory.md")

export interface MemoryEntry {
  key: string
  value: string
  tags?: string[]
}

const SEP = "\n§\n"
const KEY_PREFIX = "#memory_"

function isMissingError(error: unknown): boolean {
  if (typeof error !== "object" || error === null) return false
  const code = (error as { code?: unknown }).code
  return code === "ENOENT" || code === "ENOTDIR"
}

const optionalStat = async (file: string): Promise<{ mtimeMs: number; size: number } | null> => {
  try {
    const item = await stat(file)
    return { mtimeMs: Number(item.mtimeMs), size: Number(item.size) }
  } catch (error) {
    if (isMissingError(error)) return null
    throw error
  }
}

/** Read memory entries from the memory file */
export async function readMemories(): Promise<MemoryEntry[]> {
  try {
    const [projectStat, legacyStat, preProjectStat] = await Promise.all([
      optionalStat(getMemoryPath()),
      optionalStat(getLegacyMemoryPath()),
      optionalStat(getPreProjectMemoryPath()),
    ])
    if (!projectStat && !legacyStat && !preProjectStat) return []
    const content = await readFile(getMemoryPath(), "utf-8")
      .catch(() => readFile(getLegacyMemoryPath(), "utf-8"))
      .catch(() => readFile(getPreProjectMemoryPath(), "utf-8"))
    const blocks = content.split(SEP).filter(Boolean)
    // tags 只从正文提取：block 以 "#memory_<key>" 头行开头，若直接对整块匹配
    // 会把 key 当成标签，任何含 "memory" 的查询都会给所有条目加权（检索噪音）
    return blocks.map((block, i) => ({
      // Keep the key already stored in the file header; deriving it from the
      // array index made every key drift as soon as entries were added/evicted.
      key: block.trim().split("\n")[0]?.trim().match(/^#memory_(.+)$/i)?.[1] ?? String(i),
      value: block.trim(),
      tags: stripKeyHeader(block).match(/#\w+/g) || [],
    }))
  } catch (error) {
    console.warn("[memory-bridge] readMemories failed:", error instanceof Error ? error.message : String(error))
    return []
  }
}

/** Maximum number of memory entries to retain (FIFO eviction of oldest). */
export const MEMORY_MAX_ENTRIES = 200

/** Normalize a memory value for dedup comparison (lowercase, collapse whitespace). */
function normalizeForDedupe(value: string): string {
  return value.toLowerCase().replace(/\s+/g, " ").trim()
}

/** Strip the "#memory_<key>" header line, returning only the content. */
export function stripKeyHeader(block: string): string {
  const lines = block.split("\n")
  if (lines.length > 1 && /^#memory_/i.test(lines[0].trim())) {
    return lines.slice(1).join("\n").trim()
  }
  return block.trim()
}

/** Atomic write: write to temp file then rename to avoid partial/corrupt writes. */
async function atomicWriteFile(filePath: string, content: string): Promise<void> {
  // pid + random suffix: a bare timestamp collides when two processes write in
  // the same millisecond, and then one rename clobbers the other's temp file.
  const tmpPath = `${filePath}.tmp.${process.pid}.${Date.now()}.${Math.random().toString(36).slice(2, 8)}`
  await writeFile(tmpPath, content, "utf-8")
  try {
    // Windows can fail the rename with EPERM/EBUSY while another handle is
    // still open, so retry briefly before giving up.
    let lastError: unknown
    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        await rename(tmpPath, filePath)
        return
      } catch (error) {
        lastError = error
        if (!isMissingError(error)) {
          await new Promise((resolve) => setTimeout(resolve, 20 * (attempt + 1)))
          continue
        }
        break
      }
    }
    throw lastError
  } catch (error) {
    // Don't leave a half-written .tmp orphan behind if the rename fails.
    // 临时文件可能已被清理，删除失败不阻断
    await rm(tmpPath, { force: true }).catch(() => {})
    throw error
  }
}

/** Write a single entry to the memory file with dedup and cap enforcement. */
export async function writeMemoryFile(
  entry: MemoryEntry,
  append = true,
): Promise<void> {
  const fileLock = createFileLock(getMemoryPath())

  await fileLock.withLock(async () => {
    // P1 修复：每次写入前确保目录存在
    await mkdir(getMemDir(), { recursive: true }).catch(() => {})

    const existing = await readFile(getMemoryPath(), "utf-8")
      .catch(() => readFile(getLegacyMemoryPath(), "utf-8"))
      .catch(() => readFile(getPreProjectMemoryPath(), "utf-8"))
      .catch(() => "")

    if (!append) {
      await atomicWriteFile(getMemoryPath(), `${KEY_PREFIX}${entry.key}\n${entry.value}${SEP}`)
      invalidateMemoryCache()
      return
    }

    // Dedup: skip if normalized content already exists in the file.
    const normalizedNew = normalizeForDedupe(entry.value)
    const existingBlocks = existing.split(SEP).filter(Boolean)
    const isDuplicate = existingBlocks.some(
      (block) => normalizeForDedupe(stripKeyHeader(block)) === normalizedNew,
    )
    if (isDuplicate) return

    // Cap enforcement: FIFO-evict oldest entries when at capacity.
    let blocks = existingBlocks
    if (blocks.length >= MEMORY_MAX_ENTRIES) {
      blocks = blocks.slice(blocks.length - MEMORY_MAX_ENTRIES + 1)
    }

    const newBlock = `${KEY_PREFIX}${entry.key}\n${entry.value}`
    const content = [...blocks, newBlock].join(SEP) + SEP
    await atomicWriteFile(getMemoryPath(), content)
    invalidateMemoryCache()
  })
}

/** Compact memories: dedup existing entries and enforce the cap. */
export async function syncMemories(): Promise<MemoryEntry[]> {
  const fileLock = createFileLock(getMemoryPath())

  return await fileLock.withLock(async () => {
    // P1 修复：每次写入前确保目录存在
    await mkdir(getMemDir(), { recursive: true }).catch(() => {})
    const entries = await readMemories()
    if (entries.length === 0) return entries

    // Dedup by normalized content, keeping the first occurrence.
    const seen = new Set<string>()
    const unique: MemoryEntry[] = []
    for (const entry of entries) {
      const normalized = normalizeForDedupe(stripKeyHeader(entry.value))
      if (seen.has(normalized)) continue
      seen.add(normalized)
      unique.push(entry)
    }

    // Enforce cap: keep the most recent entries.
    const capped = unique.length > MEMORY_MAX_ENTRIES ? unique.slice(unique.length - MEMORY_MAX_ENTRIES) : unique

    // readMemories returns value = full block (header line included),
    // so write the values back as-is without prepending another header.
    const content = capped.map((e) => e.value).join(SEP) + SEP
    await atomicWriteFile(getMemoryPath(), content)
    invalidateMemoryCache()
    return capped
  })
}

/** Evict oldest entries until count <= max. */
export async function enforceMemoryCap(maxEntries?: number): Promise<void> {
  const cap = maxEntries ?? MEMORY_MAX_ENTRIES
  const fileLock = createFileLock(getMemoryPath())
  await fileLock.withLock(async () => {
    await mkdir(getMemDir(), { recursive: true }).catch(() => {})
    const entries = await readMemories()
    if (entries.length <= cap) return
    const keep = entries.slice(entries.length - cap)
    const content = keep.map((e) => e.value).join(SEP) + SEP
    await atomicWriteFile(getMemoryPath(), content)
    invalidateMemoryCache()
  })
}

let memoryCache: MemoryEntry[] | null = null
let cacheGeneration = 0

/** Invalidate the memory cache so next read re-reads from disk. */
export function invalidateMemoryCache(): void {
  memoryCache = null
  cacheGeneration++
}

/** Read memories with in-process cache (per generation). */
export async function readMemoriesCached(): Promise<MemoryEntry[]> {
  const gen = cacheGeneration
  if (memoryCache !== null && gen === cacheGeneration) return memoryCache
  const entries = await readMemories()
  if (gen === cacheGeneration) memoryCache = entries
  return entries
}

/** Get memory file info (path + mtime + size) for the newest existing file. */
export async function getMemoryFileInfo(): Promise<{ path: string; mtimeMs: number; size: number } | null> {
  const [projectStat, legacyStat, preProjectStat] = await Promise.all([
    optionalStat(getMemoryPath()),
    optionalStat(getLegacyMemoryPath()),
    optionalStat(getPreProjectMemoryPath()),
  ])

  return (
    (projectStat ? { path: getMemoryPath(), ...projectStat } : undefined) ??
    (legacyStat ? { path: getLegacyMemoryPath(), ...legacyStat } : undefined) ??
    (preProjectStat ? { path: getPreProjectMemoryPath(), ...preProjectStat } : undefined) ??
    null
  )
}

export async function getMemoryFilePath(): Promise<string> {
  const info = await getMemoryFileInfo()
  return info?.path ?? getMemoryPath()
}

// Cache invalidation helpers for tests and external callers
export function clearMemoryCache(): void {
  memoryCache = null
  cacheGeneration++
}

/** Format memory entries for prompt injection with token budget. */
export function formatMemoriesForPrompt(
  entries: MemoryEntry[],
  budget: number = MEMORY_INJECTION_BUDGET,
  fileAgeMs?: number,
): string | undefined {
  if (entries.length === 0) return undefined

  const lines: string[] = []
  let used = 0
  for (const entry of entries) {
    const line = stripKeyHeader(entry.value)
    // budget 是注入上限：超出的条目直接丢弃，避免超长记忆挤占上下文
    if (used + line.length > budget) break
    lines.push(line)
    used += line.length
  }
  if (lines.length === 0) return undefined

  const header = '<memories>'
  const footer = fileAgeMs && fileAgeMs > 24 * 60 * 60 * 1000
    ? '\n> This memory is ' + Math.round(fileAgeMs / (24 * 60 * 60 * 1000)) + ' days old. Verify against current code.'
    : ''
  const footer2 = '</memories>'

  return header + '\n' + lines.join('\n') + footer + '\n' + footer2
}

/** Search memories by keyword relevance (all query tokens must be scored). */
export async function searchMemories(query: string, limit = 20): Promise<MemoryEntry[]> {
  const trimmed = query.trim()
  if (!trimmed) return []

  const tokens = Array.from(
    new Set(
      trimmed
        .toLowerCase()
        .split(/[^\p{L}\p{N}_-]+/u)
        .filter((token) => token.length >= 2),
    ),
  )
  if (tokens.length === 0) return []

  const entries = await readMemoriesCached()
  const scored: Array<{ entry: MemoryEntry; score: number }> = []
  for (const entry of entries) {
    const haystack = `${entry.key}\n${stripKeyHeader(entry.value)}`.toLowerCase()
    let score = 0
    for (const token of tokens) {
      if (haystack.includes(token)) score++
    }
    if (score > 0) scored.push({ entry, score })
  }

  scored.sort((a, b) => b.score - a.score)
  return scored.slice(0, limit).map((item) => item.entry)
}

/** Default token budget for memory injection (2000 tokens ≈ 8000 chars). */
export const MEMORY_INJECTION_BUDGET = 8000

/** Get the age of the memory file in milliseconds. */
export async function getMemoryAgeMs(): Promise<number | undefined> {
  const info = await getMemoryFileInfo()
  if (!info) return undefined
  return Date.now() - info.mtimeMs
}