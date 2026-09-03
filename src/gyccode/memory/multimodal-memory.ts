// Multimodal Memory — 多模态知识支持
// 扩展分层记忆，支持图片、视频、代码片段等多模态内容的存储和检索

import { readFile, writeFile, mkdir } from "fs/promises"
import path from "path"
import { homedir } from "os"
import { createFileLock } from "./file-lock"

// ────────────────────── 类型定义 ──────────────────────

export type MediaType = "image" | "video" | "code" | "diagram" | "screenshot" | "document"

export interface MediaAttachment {
  /** 媒体类型 */
  type: MediaType
  /** 文件路径或 URL */
  source: string
  /** Base64 编码内容 (小文件可选嵌入) */
  base64?: string
  /** MIME 类型 */
  mimeType: string
  /** 文件大小 (bytes) */
  sizeBytes: number
  /** 描述/说明 */
  description?: string
  /** 提取的文本内容 (OCR/ASR) */
  extractedText?: string
  /** 视觉特征向量 (用于相似度检索) */
  embedding?: number[]
  /** 创建时间 */
  createdAt: number
}

export interface MultimodalMemoryEntry {
  /** 唯一标识 */
  id: string
  /** 文本内容 */
  text: string
  /** 媒体附件 */
  attachments: MediaAttachment[]
  /** 标签 */
  tags: string[]
  /** 所属技能 */
  skillId: string
  /** 所属层级 */
  layer: "public" | "private" | "visual"
  /** 创建时间 */
  createdAt: number
  /** 更新时间 */
  updatedAt: number
}

export interface SimilarityResult {
  entry: MultimodalMemoryEntry
  score: number
  matchType: "text" | "visual" | "combined"
}

export interface MultimodalSearchOptions {
  /** 文本查询 */
  query?: string
  /** 视觉特征查询 */
  visualEmbedding?: number[]
  /** 媒体类型过滤 */
  mediaType?: MediaType
  /** 标签过滤 */
  tags?: string[]
  /** 技能过滤 */
  skillId?: string
  /** 最大结果数 */
  limit?: number
  /** 文本权重 (0-1) */
  textWeight?: number
  /** 视觉权重 (0-1) */
  visualWeight?: number
}

// ────────────────────── 常量 ──────────────────────

const MULTIMODAL_ROOT = path.join(
  process.env.GYCCODE_MEMORY_HOME || process.env.HERMES_HOME || path.join(homedir(), ".gyc"),
  "memory",
  "multimodal"
)

const MAX_TEXT_LENGTH = 10000
const MAX_ATTACHMENTS_PER_ENTRY = 10
const MAX_BASE64_SIZE = 1024 * 1024 // 1MB

// ────────────────────── 简易向量工具 ──────────────────────

/** 归一化向量 */
function normalizeVector(vec: number[]): number[] {
  const norm = Math.sqrt(vec.reduce((sum, v) => sum + v * v, 0))
  return norm === 0 ? vec : vec.map(v => v / norm)
}

/** 余弦相似度 */
function cosineSimilarity(a: number[], b: number[]): number {
  if (a.length !== b.length) return 0
  const na = normalizeVector(a)
  const nb = normalizeVector(b)
  let dot = 0
  for (let i = 0; i < na.length; i++) {
    dot += na[i] * nb[i]
  }
  return dot
}

/** 从文本生成简易特征向量 (TF-based, 无外部依赖) */
export function textToEmbedding(text: string, dimensions = 128): number[] {
  const vec = new Array(dimensions).fill(0)
  const words = text.toLowerCase().split(/[^\p{L}\p{N}]+/u).filter(w => w.length >= 2)

  for (const word of words) {
    // 简单 hash 到固定维度
    let hash = 0
    for (let i = 0; i < word.length; i++) {
      hash = ((hash << 5) - hash + word.charCodeAt(i)) | 0
    }
    const idx = Math.abs(hash) % dimensions
    vec[idx] += 1
  }

  // 归一化
  return normalizeVector(vec)
}

// ────────────────────── 存储操作 ──────────────────────

function getEntryPath(skillId: string, entryId: string): string {
  return path.join(MULTIMODAL_ROOT, skillId, `${entryId}.json`)
}

function getSkillDir(skillId: string): string {
  return path.join(MULTIMODAL_ROOT, skillId)
}

const SEP = "\n§\n"

/** 读取技能的所有多模态记忆 */
export async function readMultimodalMemories(skillId: string): Promise<MultimodalMemoryEntry[]> {
  const dir = getSkillDir(skillId)
  const entries: MultimodalMemoryEntry[] = []

  try {
    const files = await import("fs/promises").then(fs => fs.readdir(dir))
    for (const file of files) {
      if (!file.endsWith(".json")) continue
      try {
        const content = await readFile(path.join(dir, file), "utf-8")
        const entry = JSON.parse(content) as MultimodalMemoryEntry
        entries.push(entry)
      } catch {
        // 忽略损坏的文件
      }
    }
  } catch {
    // 目录不存在
  }

  return entries.sort((a, b) => b.createdAt - a.createdAt)
}

/** 写入多模态记忆条目 */
export async function writeMultimodalMemory(
  entry: Omit<MultimodalMemoryEntry, "id" | "createdAt" | "updatedAt">
): Promise<MultimodalMemoryEntry> {
  const skillDir = getSkillDir(entry.skillId)
  await mkdir(skillDir, { recursive: true })

  const now = Date.now()
  const id = `mm_${now}_${Math.random().toString(36).slice(2, 8)}`

  const fullEntry: MultimodalMemoryEntry = {
    ...entry,
    id,
    createdAt: now,
    updatedAt: now,
    text: entry.text.slice(0, MAX_TEXT_LENGTH),
    attachments: entry.attachments.slice(0, MAX_ATTACHMENTS_PER_ENTRY).map(att => ({
      ...att,
      // 大文件不嵌入 base64
      base64: att.sizeBytes > MAX_BASE64_SIZE ? undefined : att.base64,
      // 自动生成嵌入向量
      embedding: att.embedding || (att.description ? textToEmbedding(att.description) : undefined),
    })),
  }

  const filePath = getEntryPath(entry.skillId, id)
  const fileLock = createFileLock(filePath)

  await fileLock.withLock(async () => {
    await writeFile(filePath, JSON.stringify(fullEntry, null, 2) + "\n", "utf-8")
  })

  return fullEntry
}

/** 删除多模态记忆条目 */
export async function deleteMultimodalMemory(skillId: string, entryId: string): Promise<boolean> {
  const filePath = getEntryPath(skillId, entryId)
  try {
    const { rm } = await import("fs/promises")
    await rm(filePath, { force: true })
    return true
  } catch {
    return false
  }
}

// ────────────────────── 搜索 ──────────────────────

/** 多模态搜索：文本 + 视觉特征联合检索 */
export async function searchMultimodalMemories(
  skillId: string,
  options: MultimodalSearchOptions = {}
): Promise<SimilarityResult[]> {
  const {
    query,
    visualEmbedding,
    mediaType,
    tags,
    limit = 20,
    textWeight = 0.6,
    visualWeight = 0.4,
  } = options

  const entries = await readMultimodalMemories(skillId)
  if (entries.length === 0) return []

  // 过滤
  let filtered = entries
  if (mediaType) {
    filtered = filtered.filter(e => e.attachments.some(a => a.type === mediaType))
  }
  if (tags && tags.length > 0) {
    filtered = filtered.filter(e => tags.some(t => e.tags.includes(t)))
  }

  // 计算相似度
  const results: SimilarityResult[] = []

  for (const entry of filtered) {
    let textScore = 0
    let visualScore = 0
    let matchType: "text" | "visual" | "combined" = "text"

    // 文本相似度
    if (query) {
      const queryEmbedding = textToEmbedding(query)
      const entryEmbedding = textToEmbedding(entry.text)
      textScore = cosineSimilarity(queryEmbedding, entryEmbedding)

      // 关键词加分
      const queryLower = query.toLowerCase()
      if (entry.text.toLowerCase().includes(queryLower)) {
        textScore = Math.min(1, textScore + 0.3)
      }
      if (entry.tags.some(t => queryLower.includes(t.toLowerCase()))) {
        textScore = Math.min(1, textScore + 0.2)
      }
    }

    // 视觉相似度
    if (visualEmbedding) {
      const entryVisuals = entry.attachments
        .filter(a => a.embedding && a.embedding.length > 0)
        .map(a => cosineSimilarity(visualEmbedding, a.embedding!))

      if (entryVisuals.length > 0) {
        visualScore = Math.max(...entryVisuals)
      }
    }

    // 综合评分
    let combinedScore = 0
    if (query && visualEmbedding) {
      combinedScore = textScore * textWeight + visualScore * visualWeight
      matchType = "combined"
    } else if (query) {
      combinedScore = textScore
      matchType = "text"
    } else if (visualEmbedding) {
      combinedScore = visualScore
      matchType = "visual"
    }

    if (combinedScore > 0) {
      results.push({ entry, score: combinedScore, matchType })
    }
  }

  results.sort((a, b) => b.score - a.score)
  return results.slice(0, limit)
}

// ────────────────────── 格式化 ──────────────────────

/** 格式化多模态记忆用于提示词注入 */
export function formatMultimodalForPrompt(
  results: SimilarityResult[],
  budget = 4096
): string | undefined {
  if (results.length === 0) return undefined

  const blocks: string[] = []
  let total = 0

  for (const result of results) {
    const header = `\n### [${result.matchType}] ${result.entry.id} (score: ${result.score.toFixed(2)})\n`
    if (total + header.length > budget) break
    blocks.push(header)
    total += header.length

    const textBlock = `${result.entry.text}\n`
    if (total + textBlock.length <= budget) {
      blocks.push(textBlock)
      total += textBlock.length
    }

    // 附件描述
    for (const att of result.entry.attachments) {
      const attLine = `- [${att.type}] ${att.description || att.source}\n`
      if (total + attLine.length <= budget) {
        blocks.push(attLine)
        total += attLine.length
      }
    }

    // 提取的文本
    for (const att of result.entry.attachments) {
      if (att.extractedText) {
        const extractedBlock = `  提取文本: ${att.extractedText.slice(0, 200)}\n`
        if (total + extractedBlock.length <= budget) {
          blocks.push(extractedBlock)
          total += extractedBlock.length
        }
      }
    }
  }

  if (blocks.length === 0) return undefined

  return [
    "<multimodal-memories>",
    "Relevant multimodal memories:",
    ...blocks,
    "</multimodal-memories>",
  ].join("\n")
}

// ────────────────────── 统计 ──────────────────────

export async function getMultimodalStats(skillId: string): Promise<{
  totalEntries: number
  totalAttachments: number
  typeDistribution: Record<MediaType, number>
  totalSizeBytes: number
}> {
  const entries = await readMultimodalMemories(skillId)
  const typeDistribution: Record<MediaType, number> = {
    image: 0,
    video: 0,
    code: 0,
    diagram: 0,
    screenshot: 0,
    document: 0,
  }
  let totalAttachments = 0
  let totalSizeBytes = 0

  for (const entry of entries) {
    totalAttachments += entry.attachments.length
    for (const att of entry.attachments) {
      typeDistribution[att.type]++
      totalSizeBytes += att.sizeBytes
    }
  }

  return {
    totalEntries: entries.length,
    totalAttachments,
    typeDistribution,
    totalSizeBytes,
  }
}

/** 获取所有有数据的技能 ID */
export async function getAllMultimodalSkillIds(): Promise<string[]> {
  try {
    const { readdir } = await import("fs/promises")
    const entries = await readdir(MULTIMODAL_ROOT, { withFileTypes: true })
    return entries.filter(e => e.isDirectory()).map(e => e.name)
  } catch {
    return []
  }
}
