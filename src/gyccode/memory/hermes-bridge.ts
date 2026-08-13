// Hermes memory bridge — gyc-cli ↔ Hermes bidirectional sync
// Based on @yunguang/memory UnifiedMemoryManager

import { readFile, rename, rm, stat, writeFile } from "fs/promises"
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
  const tmpPath = `${filePath}.tmp.${Date.now()}`
  await writeFile(tmpPath, content, "utf-8")
  try {
    await rename(tmpPath, filePath)
  } catch (error) {
    // Don't leave a half-written .tmp orphan behind if the rename fails.
    await rm(tmpPath, { force: true }).catch(() => {})
    throw error
  }
}

/** Write a single entry to Hermes memory file with dedup and cap enforcement. */
export async function writeHermesMemoryFile(
  entry: HermesMemoryEntry,
  append = true,
): Promise<void> {
  const existing = await readFile(HERMES_MEMORY_PATH, "utf-8").catch(() => "")

  if (!append) {
    await atomicWriteFile(HERMES_MEMORY_PATH, `${KEY_PREFIX}${entry.key}\n${entry.value}${SEP}`)
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
  await atomicWriteFile(HERMES_MEMORY_PATH, content)
}

/** Compact Hermes memories: dedup existing entries and enforce the cap. */
export async function syncHermesMemories(): Promise<HermesMemoryEntry[]> {
  const entries = await readHermesMemories()
  if (entries.length === 0) return entries

  // Dedup by normalized content, keeping the first occurrence.
  const seen = new Set<string>()
  const unique: HermesMemoryEntry[] = []
  for (const entry of entries) {
    const normalized = normalizeForDedupe(stripKeyHeader(entry.value))
    if (seen.has(normalized)) continue
    seen.add(normalized)
    unique.push(entry)
  }

  // Enforce cap: keep the most recent entries.
  const capped = unique.length > MEMORY_MAX_ENTRIES ? unique.slice(unique.length - MEMORY_MAX_ENTRIES) : unique

  // readHermesMemories returns value = full block (header line included),
  // so write the values back as-is without prepending another header.
  const content = capped.map((e) => e.value).join(SEP) + SEP
  await atomicWriteFile(HERMES_MEMORY_PATH, content)
  return capped
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

function tokenizeForSearch(input: string): string[] {
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
  return stripKeyHeader(entry.value)
}

// 停用词：中英文高频词不计分，避免"我/你/文件/使用"等泛化词命中大量无关记忆，
// 注入噪音稀释相关度。汉停用词为会话/代码场景高频词，英停用词为通用闭集。
const STOPWORDS = new Set([
  // 中文
  "我的", "我们", "你们", "他们", "这个", "那个", "这些", "那些", "什么", "怎么", "为什么",
  "可以", "需要", "应该", "可能", "如果", "因为", "所以", "但是", "然后", "而且", "或者",
  "还有", "一个", "一些", "没有", "不要", "不是", "就是", "都是", "是", "了", "在", "和",
  "文件", "使用", "进行", "以及", "对于", "关于", "通过", "当前", "项目", "代码", "功能",
  "问题", "时候", "自己", "现在", "已经", "里面", "那边", "这边", "这里", "那里",
  // English
  "the", "and", "that", "this", "with", "for", "you", "your", "have", "has", "not",
  "are", "was", "were", "but", "from", "they", "them", "their", "will", "would", "can",
  "could", "should", "also", "just", "then", "than", "there", "which", "when", "where",
  "what", "why", "how", "about", "into", "onto", "been", "being", "more", "most",
  "file", "files", "use", "using", "code", "project", "click", "need", "know", "make",
])

/** 候选词中剔除停用词与纯数字，保留有区分度的检索词。 */
function filterSearchTerms(terms: string[]): string[] {
  return terms.filter((t) => !STOPWORDS.has(t) && !/^\d+$/.test(t))
}

/**
 * 按 TF-IDF 评分：标签命中×2、内容命中×1，再乘 IDF（词在越少记忆中出现越稀有、越该加权）。
 * 停用词不计分。纯内存计算，低 CPU；无命中时返回空（不注入噪音）。
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

  const terms = filterSearchTerms(tokenizeForSearch(query))
  if (terms.length === 0) return []

  // IDF 统计：每个词出现在多少条记忆里（docFrequency）。语料小（≤200 条），
  // 每次查询全量扫描一次成本可忽略，且与 readHermesMemoriesCached 共享缓存。
  const texts = entries.map((entry) => ({
    entry,
    text: cleanEntryValue(entry).toLowerCase(),
    tags: (entry.tags ?? []).join(" ").toLowerCase(),
  }))
  const docFrequency = new Map<string, number>()
  for (const { text, tags } of texts) {
    const seen = new Set<string>()
    for (const term of terms) {
      if (text.includes(term) || tags.includes(term)) {
        if (!seen.has(term)) {
          seen.add(term)
          docFrequency.set(term, (docFrequency.get(term) ?? 0) + 1)
        }
      }
    }
  }
  const totalDocs = texts.length
  const idf = (term: string): number => {
    const df = docFrequency.get(term) ?? 0
    // 平滑 IDF：log(1 + N/(1+df))，避免除零；df 越大权重越低。
    return Math.log(1 + totalDocs / (1 + df))
  }

  const scored: Array<{ entry: HermesMemoryEntry; score: number }> = []
  for (const { entry, text, tags } of texts) {
    let score = 0
    for (const term of terms) {
      if (tags.includes(term)) score += 2 * idf(term)
      if (text.includes(term)) score += 1 * idf(term)
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

/** Memories older than this are flagged as potentially stale (default: 3 days). */
export const MEMORY_FRESHNESS_THRESHOLD_MS = 3 * 24 * 60 * 60 * 1000


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
