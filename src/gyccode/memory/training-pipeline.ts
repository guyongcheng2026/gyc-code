// Training Data Pipeline — 训练数据飞轮
// 从会话日志中提取成功任务模式，构建训练数据集

import { readFile, writeFile, mkdir, readdir } from "fs/promises"
import path from "path"
import { homedir } from "os"

// ────────────────────── 类型定义 ──────────────────────

export interface TaskLogEntry {
  /** 时间戳 */
  ts: string
  /** 任务类别 */
  category: "code-generation" | "review" | "debugging" | "documentation" | "refactoring" | "testing" | "other"
  /** 任务描述/输入 */
  input: string
  /** 生成的输出/代码 */
  output: string
  /** 是否成功 */
  success: boolean
  /** 耗时(ms) */
  durationMs?: number
  /** 使用的技能 */
  skillUsed?: string
  /** 标签 */
  tags?: string[]
  /** 质量评分 (0-100) */
  qualityScore?: number
  /** 错误信息(失败时) */
  error?: string
}

export interface TrainingSample {
  id: string
  category: TaskLogEntry["category"]
  input: string
  output: string
  qualityScore: number
  tags: string[]
  source: string
  createdAt: string
}

export interface TrainingDataset {
  version: string
  createdAt: string
  stats: DatasetStats
  samples: TrainingSample[]
}

export interface DatasetStats {
  totalSamples: number
  successfulTasks: number
  failedTasks: number
  avgQualityScore: number
  categoryDistribution: Record<string, number>
  tagFrequency: Record<string, number>
  avgInputLength: number
  avgOutputLength: number
}

export interface PipelineConfig {
  /** 任务日志目录 */
  taskLogDir: string
  /** 输出训练集路径 */
  outputPath: string
  /** 最小质量分数 */
  minQualityScore: number
  /** 最大训练样本数 */
  maxSamples: number
  /** 去重阈值 (相似度) */
  dedupThreshold: number
  /** 类别过滤 */
  categories?: TaskLogEntry["category"][]
}

// ────────────────────── 常量 ──────────────────────

const MEMORY_ROOT = path.join(
  process.env.GYCCODE_MEMORY_HOME || process.env.HERMES_HOME || path.join(homedir(), ".gyc"),
  "memory"
)

const DEFAULT_CONFIG: PipelineConfig = {
  taskLogDir: path.join(MEMORY_ROOT, "task-logs"),
  outputPath: path.join(MEMORY_ROOT, "training-set.jsonl"),
  minQualityScore: 60,
  maxSamples: 10000,
  dedupThreshold: 0.8,
}

// ────────────────────── 日志读取 ──────────────────────

/** 读取所有任务日志文件 */
export async function readTaskLogs(logDir: string): Promise<TaskLogEntry[]> {
  const entries: TaskLogEntry[] = []

  try {
    const files = await readdir(logDir)
    const logFiles = files.filter(f => f.endsWith(".jsonl") || f.endsWith(".json"))

    for (const file of logFiles) {
      const filePath = path.join(logDir, file)
      try {
        const content = await readFile(filePath, "utf-8")
        const lines = content.split("\n").filter(Boolean)

        for (const line of lines) {
          try {
            const entry = JSON.parse(line) as TaskLogEntry
            if (entry.ts && entry.input && entry.output) {
              entries.push(entry)
            }
          } catch {
            // 忽略格式错误的行
          }
        }
      } catch {
        // 忽略读取失败的文件
      }
    }
  } catch {
    // 目录不存在
  }

  return entries
}

/** 从 stability-log.jsonl 提取健康数据作为辅助特征 */
export async function readStabilityLog(): Promise<Array<{ ts: string; alive: boolean; uptimeHours: number }>> {
  const stabilityPath = path.join(process.cwd(), "stability-log.jsonl")
  const entries: Array<{ ts: string; alive: boolean; uptimeHours: number }> = []

  try {
    const content = await readFile(stabilityPath, "utf-8")
    const lines = content.split("\n").filter(Boolean)

    for (const line of lines) {
      try {
        const parsed = JSON.parse(line)
        entries.push({
          ts: parsed.ts,
          alive: parsed.alive,
          uptimeHours: parsed.uptimeHours,
        })
      } catch {
        // 忽略
      }
    }
  } catch {
    // 忽略
  }

  return entries
}

// ────────────────────── 质量评估 ──────────────────────

/** 计算任务日志条目的质量分数 */
export function computeQualityScore(entry: TaskLogEntry): number {
  let score = 50 // 基础分

  // 成功加分
  if (entry.success) score += 20

  // 输出长度合理性 (过短扣分，适中加分)
  const outputLen = entry.output.length
  if (outputLen < 10) score -= 15
  else if (outputLen < 50) score -= 5
  else if (outputLen > 100 && outputLen < 5000) score += 10

  // 有标签加分
  if (entry.tags && entry.tags.length > 0) score += 5

  // 有技能关联加分
  if (entry.skillUsed) score += 5

  // 耗时合理 (太慢扣分)
  if (entry.durationMs) {
    if (entry.durationMs > 60000) score -= 10
    else if (entry.durationMs < 5000) score += 5
  }

  // 有自定义质量评分则使用
  if (entry.qualityScore !== undefined) {
    score = Math.round((score + entry.qualityScore) / 2)
  }

  return Math.max(0, Math.min(100, score))
}

// ────────────────────── 去重 ──────────────────────

/** 归一化文本用于去重比较 */
function normalizeText(text: string): string {
  return text
    .toLowerCase()
    .replace(/\s+/g, " ")
    .replace(/[^\p{L}\p{N}]+/gu, "")
    .trim()
}

/** 计算两个字符串的 Jaccard 相似度 */
function jaccardSimilarity(a: string, b: string): number {
  const setA = new Set(a.split(" "))
  const setB = new Set(b.split(" "))
  const intersection = new Set([...setA].filter(x => setB.has(x)))
  const union = new Set([...setA, ...setB])
  return union.size === 0 ? 0 : intersection.size / union.size
}

/** 去重：移除高度相似的样本 */
function deduplicateSamples(
  samples: TrainingSample[],
  threshold: number
): TrainingSample[] {
  const unique: TrainingSample[] = []

  for (const sample of samples) {
    const normalizedInput = normalizeText(sample.input)
    const isDuplicate = unique.some(
      existing => jaccardSimilarity(normalizedInput, normalizeText(existing.input)) > threshold
    )
    if (!isDuplicate) {
      unique.push(sample)
    }
  }

  return unique
}

// ────────────────────── 管道主逻辑 ──────────────────────

/** 构建训练数据集 */
export async function buildTrainingDataset(
  config: Partial<PipelineConfig> = {}
): Promise<TrainingDataset> {
  const fullConfig = { ...DEFAULT_CONFIG, ...config }

  // 1. 读取日志
  const logs = await readTaskLogs(fullConfig.taskLogDir)

  // 2. 过滤成功任务
  const successful = logs.filter(l => l.success)

  // 3. 类别过滤
  const filtered = fullConfig.categories
    ? successful.filter(l => fullConfig.categories!.includes(l.category))
    : successful

  // 4. 评分并过滤低质量
  const scored = filtered.map(entry => ({
    entry,
    score: computeQualityScore(entry),
  })).filter(s => s.score >= fullConfig.minQualityScore)

  // 5. 转换为训练样本
  let samples: TrainingSample[] = scored.map(({ entry, score }, i) => ({
    id: `sample_${Date.now()}_${i}`,
    category: entry.category,
    input: entry.input,
    output: entry.output,
    qualityScore: score,
    tags: entry.tags || [],
    source: entry.skillUsed || "unknown",
    createdAt: entry.ts,
  }))

  // 6. 去重
  samples = deduplicateSamples(samples, fullConfig.dedupThreshold)

  // 7. 限制数量 (取质量最高的)
  samples.sort((a, b) => b.qualityScore - a.qualityScore)
  samples = samples.slice(0, fullConfig.maxSamples)

  // 8. 统计
  const stats = computeDatasetStats(samples, logs.length)

  return {
    version: "1.0.0",
    createdAt: new Date().toISOString(),
    stats,
    samples,
  }
}

/** 计算数据集统计 */
function computeDatasetStats(
  samples: TrainingSample[],
  totalLogs: number
): DatasetStats {
  const categoryDistribution: Record<string, number> = {}
  const tagFrequency: Record<string, number> = {}
  let totalInputLen = 0
  let totalOutputLen = 0
  let totalQuality = 0

  for (const sample of samples) {
    categoryDistribution[sample.category] = (categoryDistribution[sample.category] || 0) + 1
    for (const tag of sample.tags) {
      tagFrequency[tag] = (tagFrequency[tag] || 0) + 1
    }
    totalInputLen += sample.input.length
    totalOutputLen += sample.output.length
    totalQuality += sample.qualityScore
  }

  return {
    totalSamples: samples.length,
    successfulTasks: totalLogs,
    failedTasks: 0,
    avgQualityScore: samples.length > 0 ? Math.round(totalQuality / samples.length) : 0,
    categoryDistribution,
    tagFrequency,
    avgInputLength: samples.length > 0 ? Math.round(totalInputLen / samples.length) : 0,
    avgOutputLength: samples.length > 0 ? Math.round(totalOutputLen / samples.length) : 0,
  }
}

/** 导出为 JSONL 格式 */
export async function exportToJsonl(
  dataset: TrainingDataset,
  outputPath: string
): Promise<void> {
  await mkdir(path.dirname(outputPath), { recursive: true })

  const lines = dataset.samples.map(sample =>
    JSON.stringify({
      instruction: sample.input,
      output: sample.output,
      category: sample.category,
      quality_score: sample.qualityScore,
      tags: sample.tags,
    })
  )

  await writeFile(outputPath, lines.join("\n") + "\n", "utf-8")
}

/** 导出为 JSON 格式 (含统计) */
export async function exportToJson(
  dataset: TrainingDataset,
  outputPath: string
): Promise<void> {
  await mkdir(path.dirname(outputPath), { recursive: true })
  await writeFile(outputPath, JSON.stringify(dataset, null, 2) + "\n", "utf-8")
}

// ────────────────────── 便捷函数 ──────────────────────

/** 快速构建训练集并导出 */
export async function quickBuild(config: Partial<PipelineConfig> = {}): Promise<DatasetStats> {
  const dataset = await buildTrainingDataset(config)
  const jsonlPath = config.outputPath || DEFAULT_CONFIG.outputPath
  const jsonPath = jsonlPath.replace(/\.jsonl$/, ".json")

  await exportToJsonl(dataset, jsonlPath)
  await exportToJson(dataset, jsonPath)

  return dataset.stats
}
