// Hermes memory bridge — gyc-cli ↔ Hermes bidirectional sync
// Based on @yunguang/memory UnifiedMemoryManager

import { readFile, stat, writeFile } from "fs/promises"
import path from "path"
import { homedir } from "os"

const HERMES_MEMORY_PATH = path.join(
  process.env.HERMES_HOME || path.join(homedir(), ".gyc"),
  "memory",
  "hermes_gyccode_memory.md",
)

export interface HermesMemoryEntry {
  key: string
  value: string
  tags?: string[]
}

const SEP = "\n§\n"
const KEY_PREFIX = "#memory_"

/** Read memory entries from Hermes memory file */
export async function readHermesMemories(): Promise<HermesMemoryEntry[]> {
  try {
    const content = await readFile(HERMES_MEMORY_PATH, "utf-8")
    const blocks = content.split(SEP).filter(Boolean)
    return blocks.map((block, i) => ({
      key: KEY_PREFIX + i,
      value: block.trim(),
      tags: block.match(/#\w+/g) || [],
    }))
  } catch {
    return []
  }
}

/** Write a single entry to Hermes memory file */
export async function writeHermesMemoryFile(
  entry: HermesMemoryEntry,
  append = true,
): Promise<void> {
  const line = `${KEY_PREFIX}${entry.key}\n${entry.value}${SEP}`
  if (append) {
    const existing = await readFile(HERMES_MEMORY_PATH, "utf-8").catch(() => "")
    await writeFile(HERMES_MEMORY_PATH, existing + line, "utf-8")
  } else {
    await writeFile(HERMES_MEMORY_PATH, line, "utf-8")
  }
}

/** Sync all Hermes memories (experimental) */
export async function syncHermesMemories(): Promise<HermesMemoryEntry[]> {
  const entries = await readHermesMemories()
  const content = entries.map((e) => e.value).join(SEP)
  if (content) {
    await writeFile(HERMES_MEMORY_PATH, content, "utf-8")
  }
  return entries
}

/** 记忆注入系统提示的字符预算（与 MCP 指令预算一致，4KB） */
export const MEMORY_INJECTION_BUDGET = 4_096

// 模块级缓存：记忆文件 mtime/size 未变时复用，避免每轮请求重复读盘（低 IO）
let cachedStat: { mtimeMs: number; size: number } | undefined
let cachedEntries: HermesMemoryEntry[] | undefined

async function readHermesMemoriesCached(): Promise<HermesMemoryEntry[]> {
  try {
    const fileStat = await stat(HERMES_MEMORY_PATH)
    if (cachedStat && cachedStat.mtimeMs === fileStat.mtimeMs && cachedStat.size === fileStat.size) {
      return cachedEntries ?? []
    }
    cachedStat = { mtimeMs: fileStat.mtimeMs, size: fileStat.size }
    cachedEntries = await readHermesMemories()
    return cachedEntries
  } catch {
    return []
  }
}

function tokenize(input: string): string[] {
  const tokens: string[] = []
  for (const word of input.toLowerCase().split(/[^\p{L}\p{N}]+/u)) {
    if (word.length < 2) continue
    if (/^[\p{Script=Han}]+$/u.test(word)) {
      // 中文连续串：整串 + 2-gram（保证长短词组都能命中）
      tokens.push(word)
      for (let i = 0; i + 2 <= word.length; i++) {
        tokens.push(word.slice(i, i + 2))
      }
    } else {
      tokens.push(word)
    }
  }
  return [...new Set(tokens)]
}

/** 剥离写入时残留的 "#memory_<key>" 首行，只保留实际记忆内容 */
function cleanEntryValue(entry: HermesMemoryEntry): string {
  const value = entry.value.trim()
  const lines = value.split("\n")
  if (lines.length > 1 && /^#memory_/i.test(lines[0].trim())) {
    return lines.slice(1).join("\n").trim()
  }
  return value
}

/**
 * 按关键词/标签粗筛记忆条目：标签命中×2、内容命中×1，按分数降序返回。
 * 纯内存计算，低 CPU；无命中时返回空（不注入噪音）。
 * 同一会话的连续循环 query 相同，命中结果按 query 短 TTL 缓存，避免重复遍历。
 */
const searchCache = new Map<string, { time: number; entries: HermesMemoryEntry[] }>()
const SEARCH_CACHE_TTL_MS = 30_000
const SEARCH_CACHE_MAX = 20

export async function searchHermesMemories(query: string, limit = 20): Promise<HermesMemoryEntry[]> {
  const cacheKey = `${query}:${limit}`
  const hit = searchCache.get(cacheKey)
  if (hit && Date.now() - hit.time < SEARCH_CACHE_TTL_MS) return hit.entries

  const entries = await readHermesMemoriesCached()
  if (entries.length === 0) return []

  const terms = tokenize(query)
  if (terms.length === 0) return []

  const scored: Array<{ entry: HermesMemoryEntry; score: number }> = []
  for (const entry of entries) {
    const text = cleanEntryValue(entry).toLowerCase()
    const tagText = (entry.tags ?? []).join(" ").toLowerCase()
    let score = 0
    for (const term of terms) {
      if (tagText.includes(term)) score += 2
      if (text.includes(term)) score += 1
    }
    if (score > 0) scored.push({ entry, score })
  }

  scored.sort((a, b) => b.score - a.score)
  const result = scored.slice(0, limit).map((item) => item.entry)

  if (searchCache.size >= SEARCH_CACHE_MAX) {
    const oldest = searchCache.keys().next().value
    if (oldest !== undefined) searchCache.delete(oldest)
  }
  searchCache.set(cacheKey, { time: Date.now(), entries: result })
  return result
}


/** Format retrieved memories as a system-prompt segment, capped by budget. */
export function formatMemoriesForPrompt(
  entries: readonly HermesMemoryEntry[],
  budget = MEMORY_INJECTION_BUDGET,
  fileAgeMs?: number,
): string | undefined {
  if (entries.length === 0) return undefined

  const blocks: string[] = []
  let total = 0
  for (const entry of entries) {
    const line = `- ${cleanEntryValue(entry)}`
    const block = `${line}\n`
    if (blocks.length === 0 || total + block.length <= budget) {
      blocks.push(block)
      total += block.length
    } else {
      break
    }
  }
  if (blocks.length === 0) return undefined

  const header = ["<memories>", "Relevant memories from previous sessions:", ...blocks, "</memories>"].join("\n")
  // Anti-hallucination freshness: when the memory file predates a threshold,
  // tell the model the remembered facts may be stale so it verifies against
  // current code before asserting them (aligned with Claude Code memoryAge).
  if (fileAgeMs !== undefined && fileAgeMs >= MEMORY_FRESHNESS_THRESHOLD_MS) {
    const days = Math.floor(fileAgeMs / (24 * 60 * 60 * 1000))
    return `${header}\n\n<system-reminder>This memory is ${days} days old. Facts, paths, and line numbers may have changed since then. Verify against current code before asserting them as fact.</system-reminder>`
  }
  return header
}

/** Memories older than this are flagged as potentially stale (default: 7 days). */
export const MEMORY_FRESHNESS_THRESHOLD_MS = 7 * 24 * 60 * 60 * 1000


/**
 * Age of the hermes memory file in milliseconds (undefined when missing).
 * Used by the system prompt to flag potentially stale memories.
 */
export async function getHermesMemoryAgeMs(): Promise<number | undefined> {
  try {
    const fileStat = await stat(HERMES_MEMORY_PATH)
    return Date.now() - fileStat.mtimeMs
  } catch {
    return undefined
  }
}
