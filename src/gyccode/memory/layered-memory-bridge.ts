// Layered Memory Bridge — gyc-code 分层记忆存储（兼容 Hermes 技能结构）
// 支持 PUBLIC/PRIVATE/RULE/MODEL/TEMPLATES 分层，按技能隔离

import { readFile, rename, rm, stat, writeFile, mkdir, readdir } from "fs/promises"
import path from "path"
import { homedir } from "os"
import { createFileLock } from "./file-lock"

export type KnowledgeLayer = "public" | "private" | "rule" | "model" | "template"

export interface LayeredMemoryEntry {
  key: string
  value: string
  layer: KnowledgeLayer
  skillId: string
  tags?: string[]
  createdAt: number
  updatedAt: number
}

export interface MemoryLayerConfig {
  layer: KnowledgeLayer
  maxEntries: number
  path: string
}

const SEP = "\n§\n"
const KEY_PREFIX = "#memory_"

const DEFAULT_LAYER_CONFIGS: Record<KnowledgeLayer, Omit<MemoryLayerConfig, "path">> = {
  public: { layer: "public", maxEntries: 500 },
  private: { layer: "private", maxEntries: 200 },
  rule: { layer: "rule", maxEntries: 100 },
  model: { layer: "model", maxEntries: 100 },
  template: { layer: "template", maxEntries: 50 },
}

function getMemoryRoot(): string {
  return path.join(
    process.env.GYCCODE_MEMORY_HOME || process.env.HERMES_HOME || path.join(homedir(), ".gyc"),
    "memory",
    "layered"
  )
}

function getLayerPath(skillId: string, layer: KnowledgeLayer): string {
  const root = getMemoryRoot()
  return path.join(root, skillId, layer, `${layer}_memory.md`)
}

function getLegacyLayerPath(skillId: string, layer: KnowledgeLayer): string {
  const root = getMemoryRoot()
  return path.join(root, skillId, layer, `hermes_${layer}_memory.md`)
}

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
    await rm(tmpPath, { force: true }).catch(() => {})
    throw error
  }
}

function parseMemoryBlocks(content: string, skillId: string, layer: KnowledgeLayer): LayeredMemoryEntry[] {
  const blocks = content.split(SEP).filter(Boolean)
  return blocks.map((block, i) => {
    const lines = block.split("\n")
    let key = KEY_PREFIX + i
    let value = block
    let tags: string[] = []
    let createdAt = Date.now()
    let updatedAt = Date.now()

    if (lines.length > 1 && /^#memory_/i.test(lines[0].trim())) {
      key = lines[0].trim()
      value = lines.slice(1).join("\n")
      // 尝试解析元数据行（如果存在）
      const metaLine = lines[1]?.trim()
      if (metaLine?.startsWith("{") && metaLine.endsWith("}")) {
        try {
          const meta = JSON.parse(metaLine)
          tags = meta.tags || []
          createdAt = meta.createdAt || Date.now()
          updatedAt = meta.updatedAt || Date.now()
          value = lines.slice(2).join("\n")
        } catch {
          // 忽略解析错误，使用默认值
        }
      }
    }

    return {
      key,
      value: value.trim(),
      layer,
      skillId,
      tags: tags.length > 0 ? tags : (block.match(/#\w+/g) || []),
      createdAt,
      updatedAt,
    }
  })
}

function formatMemoryEntry(entry: LayeredMemoryEntry): string {
  const meta = JSON.stringify({
    tags: entry.tags,
    createdAt: entry.createdAt,
    updatedAt: entry.updatedAt,
  })
  return `${entry.key}\n${meta}\n${entry.value}`
}

/** Read memory entries from a specific skill and layer */
export async function readLayeredMemories(skillId: string, layer: KnowledgeLayer): Promise<LayeredMemoryEntry[]> {
  const filePath = getLayerPath(skillId, layer)
  const legacyPath = getLegacyLayerPath(skillId, layer)

  try {
    const content = await readFile(filePath, "utf-8").catch(() => readFile(legacyPath, "utf-8"))
    return parseMemoryBlocks(content, skillId, layer)
  } catch {
    return []
  }
}

/** Read all memories across all layers for a skill */
export async function readAllSkillMemories(skillId: string): Promise<LayeredMemoryEntry[]> {
  const layers: KnowledgeLayer[] = ["public", "private", "rule", "model", "template"]
  const allEntries: LayeredMemoryEntry[] = []

  for (const layer of layers) {
    const entries = await readLayeredMemories(skillId, layer)
    allEntries.push(...entries)
  }

  return allEntries
}

/** Write a single entry to a specific skill and layer with dedup and cap enforcement */
export async function writeLayeredMemory(
  skillId: string,
  layer: KnowledgeLayer,
  entry: Omit<LayeredMemoryEntry, "layer" | "skillId" | "createdAt" | "updatedAt"> & { tags?: string[] },
  append = true
): Promise<void> {
  const filePath = getLayerPath(skillId, layer)
  const config = DEFAULT_LAYER_CONFIGS[layer]
  const maxEntries = config.maxEntries

  // 确保目录存在
  await mkdir(path.dirname(filePath), { recursive: true })

  const fileLock = createFileLock(filePath)

  await fileLock.withLock(async () => {
    const existingContent = await readFile(filePath, "utf-8").catch(() => "")
    const existingEntries = existingContent ? parseMemoryBlocks(existingContent, skillId, layer) : []

    const now = Date.now()
    const newEntry: LayeredMemoryEntry = {
      ...entry,
      layer,
      skillId,
      tags: entry.tags || [],
      createdAt: now,
      updatedAt: now,
    }

    if (!append) {
      await atomicWriteFile(filePath, formatMemoryEntry(newEntry) + SEP)
      return
    }

    // Dedup: skip if normalized content already exists in the file.
    const normalizedNew = normalizeForDedupe(newEntry.value)
    const isDuplicate = existingEntries.some(
      (e) => normalizeForDedupe(stripKeyHeader(e.value)) === normalizedNew,
    )
    if (isDuplicate) return

    // Cap enforcement: FIFO-evict oldest entries when at capacity.
    let entries = existingEntries
    if (entries.length >= maxEntries) {
      entries = entries.slice(entries.length - maxEntries + 1)
    }

    const content = [...entries, newEntry].map(formatMemoryEntry).join(SEP) + SEP
    await atomicWriteFile(filePath, content)
  })
}

/** Compact memories for a skill and layer: dedup and enforce cap */
export async function syncLayeredMemories(skillId: string, layer: KnowledgeLayer): Promise<LayeredMemoryEntry[]> {
  const filePath = getLayerPath(skillId, layer)
  const config = DEFAULT_LAYER_CONFIGS[layer]
  const maxEntries = config.maxEntries

  const fileLock = createFileLock(filePath)

  return await fileLock.withLock(async () => {
    const entries = await readLayeredMemories(skillId, layer)
    if (entries.length === 0) return entries

    // Dedup by normalized content, keeping the most recent occurrence.
    const seen = new Map<string, LayeredMemoryEntry>()
    for (const entry of entries) {
      const normalized = normalizeForDedupe(stripKeyHeader(entry.value))
      const existing = seen.get(normalized)
      if (!existing || entry.updatedAt > existing.updatedAt) {
        seen.set(normalized, entry)
      }
    }

    const unique = Array.from(seen.values()).sort((a, b) => a.updatedAt - b.updatedAt)
    const capped = unique.length > maxEntries ? unique.slice(unique.length - maxEntries) : unique

    const content = capped.map(formatMemoryEntry).join(SEP) + SEP
    await atomicWriteFile(filePath, content)
    return capped
  })
}

/** Sync all layers for a skill */
export async function syncAllSkillMemories(skillId: string): Promise<Map<KnowledgeLayer, LayeredMemoryEntry[]>> {
  const layers: KnowledgeLayer[] = ["public", "private", "rule", "model", "template"]
  const results = new Map<KnowledgeLayer, LayeredMemoryEntry[]>()

  for (const layer of layers) {
    results.set(layer, await syncLayeredMemories(skillId, layer))
  }

  return results
}

/** Search memories across layers with layer-aware scoring */
export async function searchLayeredMemories(
  skillId: string,
  query: string,
  options: {
    layers?: KnowledgeLayer[]
    limit?: number
    layerWeights?: Partial<Record<KnowledgeLayer, number>>
  } = {}
): Promise<LayeredMemoryEntry[]> {
  const { layers = ["public", "private", "rule", "model"], limit = 20, layerWeights = {} } = options

  const defaultWeights: Record<KnowledgeLayer, number> = {
    public: 1.0,
    private: 1.2,
    rule: 1.5,
    model: 1.3,
    template: 0.8,
  }

  const weights = { ...defaultWeights, ...layerWeights }

  const allEntries: LayeredMemoryEntry[] = []
  for (const layer of layers) {
    const entries = await readLayeredMemories(skillId, layer)
    allEntries.push(...entries)
  }

  if (allEntries.length === 0) return []

  // Simple tokenization
  const tokens = query.toLowerCase().split(/[^\p{L}\p{N}]+/u).filter(t => t.length >= 2)

  const scored = allEntries.map(entry => {
    const text = stripKeyHeader(entry.value).toLowerCase()
    const tagText = (entry.tags || []).join(" ").toLowerCase()
    let score = 0

    for (const token of tokens) {
      if (tagText.includes(token)) score += 3 * (weights[entry.layer] || 1)
      if (text.includes(token)) score += 1 * (weights[entry.layer] || 1)
    }

    return { entry, score }
  }).filter(s => s.score > 0)

  scored.sort((a, b) => b.score - a.score)
  return scored.slice(0, limit).map(s => s.entry)
}

/** Format memories for prompt injection with layer context */
export function formatLayeredMemoriesForPrompt(
  entries: readonly LayeredMemoryEntry[],
  budget = 4096
): string | undefined {
  if (entries.length === 0) return undefined

  const layerGroups = new Map<KnowledgeLayer, LayeredMemoryEntry[]>()
  for (const entry of entries) {
    const group = layerGroups.get(entry.layer) || []
    group.push(entry)
    layerGroups.set(entry.layer, group)
  }

  const layerOrder: KnowledgeLayer[] = ["rule", "model", "public", "private", "template"]
  const blocks: string[] = []
  let total = 0

  for (const layer of layerOrder) {
    const group = layerGroups.get(layer)
    if (!group) continue

    const layerHeader = `\n## ${layer.toUpperCase()} Memories\n`
    if (total + layerHeader.length > budget) break

    blocks.push(layerHeader)
    total += layerHeader.length

    for (const entry of group) {
      const line = `- ${stripKeyHeader(entry.value)}\n`
      if (total + line.length <= budget) {
        blocks.push(line)
        total += line.length
      } else {
        break
      }
    }
  }

  if (blocks.length === 0) return undefined

  return ["<layered-memories>", "Relevant memories from previous sessions (organized by layer):", ...blocks, "</layered-memories>"].join("\n")
}

/** Get all skill IDs that have memory data */
export async function getAllSkillIds(): Promise<string[]> {
  const root = getMemoryRoot()
  try {
    const entries = await readdir(root, { withFileTypes: true })
    return entries.filter(e => e.isDirectory()).map(e => e.name)
  } catch {
    return []
  }
}

/** Delete all memories for a skill (cleanup) */
export async function deleteSkillMemories(skillId: string): Promise<void> {
  const root = getMemoryRoot()
  const skillPath = path.join(root, skillId)
  await rm(skillPath, { recursive: true, force: true }).catch(() => {})
}

/** Get memory stats for a skill */
export async function getSkillMemoryStats(skillId: string): Promise<Record<KnowledgeLayer, { count: number; size: number; oldest: number; newest: number }>> {
  const layers: KnowledgeLayer[] = ["public", "private", "rule", "model", "template"]
  const stats: Record<KnowledgeLayer, { count: number; size: number; oldest: number; newest: number }> = {
    public: { count: 0, size: 0, oldest: 0, newest: 0 },
    private: { count: 0, size: 0, oldest: 0, newest: 0 },
    rule: { count: 0, size: 0, oldest: 0, newest: 0 },
    model: { count: 0, size: 0, oldest: 0, newest: 0 },
    template: { count: 0, size: 0, oldest: 0, newest: 0 },
  }

  for (const layer of layers) {
    const entries = await readLayeredMemories(skillId, layer)
    if (entries.length > 0) {
      stats[layer] = {
        count: entries.length,
        size: entries.reduce((sum, e) => sum + e.value.length, 0),
        oldest: Math.min(...entries.map(e => e.createdAt)),
        newest: Math.max(...entries.map(e => e.updatedAt)),
      }
    }
  }

  return stats
}