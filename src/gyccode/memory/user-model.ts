// 谷总画像层：跨会话累积的稳定偏好与身份信息。
//
// 与 memory-bridge.ts 的会话记忆文件是**两层不同的东西**：
//   - 记忆文件记「发生过什么」——事实、决策、本次任务的经验，纯 FIFO 淘汰；
//   - 画像层记「谷总是谁、偏好如何」——超限时优先保留偏好类条目而非最旧条目。
//
// 落盘位置与 memory-bridge 同一套解析顺序（`$GYC_HOME/memory/USER.md`），因此它
// 与记忆文件是兄弟文件而非同一份。注意 Hermes 自己的画像是
// `$HERMES_HOME/memories/USER.md`（memories 复数），与本文件的 `memory`（单数）
// 不同目录，不会互相覆盖。

import { mkdir, readFile, rename, rm, writeFile } from "fs/promises"
import path from "path"
import { homedir } from "os"

/** 条目分隔符，与 memory-bridge.ts 保持一致。 */
const SEP = "\n§\n"

/** 画像层字符上限，对齐 Hermes 的 USER.md 限额（1375），取整便于文案。 */
export const USER_CHAR_LIMIT = 1_400

/** 注入系统提示的字符预算，与上限一致——画像层本身就很小，无需二次裁剪。 */
export const USER_MODEL_INJECTION_BUDGET = USER_CHAR_LIMIT

export interface UserModelEntry {
  key: string
  value: string
  tags: string[]
}

// 偏好判定信号。这是「进画像层还是进记忆层」的唯一判据，extract.ts 也复用它，
// 避免两处各写一套规则而漂移。
const PREFERENCE_SIGNALS = [
  "不要",
  "别",
  "一律",
  "禁止",
  "必须",
  "偏好",
  "风格",
  "称呼",
  "prefer",
  "always",
  "never",
  "don't",
  "do not",
]

/** 该条目是否描述了谷总的偏好 / 风格 / 交互约定（而非一次性事实）。 */
export function isPreferenceEntry(text: string): boolean {
  const lowered = text.toLowerCase()
  return PREFERENCE_SIGNALS.some((signal) => lowered.includes(signal.toLowerCase()))
}

/** 抽取结果的分流判据：偏好进画像层，其余进记忆层。默认归记忆层（保守）。 */
export function classifyMemoryTarget(text: string): "user" | "memory" {
  return isPreferenceEntry(text) ? "user" : "memory"
}

function memoryDir(): string {
  const base =
    process.env.GYCCODE_MEMORY_HOME || process.env.HERMES_HOME || path.join(homedir(), ".gyc")
  return path.join(base, "memory")
}

export function userModelPath(): string {
  return path.join(memoryDir(), "USER.md")
}

function normalizeForDedupe(value: string): string {
  return value.toLowerCase().replace(/\s+/g, " ").trim()
}

async function atomicWrite(file: string, content: string): Promise<void> {
  const tmp = `${file}.tmp.${Date.now()}`
  await writeFile(tmp, content, "utf-8")
  try {
    await rename(tmp, file)
  } catch (error) {
    await rm(tmp, { force: true }).catch(() => {})
    throw error
  }
}

function parse(content: string): UserModelEntry[] {
  return content
    .split(SEP)
    .map((block) => block.trim())
    .filter((block) => block.length > 0)
    .map((block, index) => ({ key: `user_${index}`, value: block, tags: block.match(/#\w+/g) ?? [] }))
}

/** 读画像条目。文件缺失或损坏都返回空数组——画像层是尽力而为的，不阻断会话。 */
export async function readUserModel(): Promise<UserModelEntry[]> {
  try {
    const content = await readFile(userModelPath(), "utf-8")
    return parse(content)
  } catch {
    return []
  }
}

// 画像层每轮循环都会被读取，用一层短 TTL 缓存避免重复读盘。
// 写入后立即失效，保证同进程内读写一致。
let cached: { time: number; value: UserModelEntry[] } | undefined
const CACHE_TTL_MS = 30_000

export async function readUserModelCached(): Promise<UserModelEntry[]> {
  if (cached !== undefined && Date.now() - cached.time < CACHE_TTL_MS) return cached.value
  const value = await readUserModel()
  cached = { time: Date.now(), value }
  return value
}

/**
 * 去重后执行字符上限。
 *
 * 超限时**不**做纯 FIFO：先尽量保留偏好类条目，再用剩余预算按「新的优先」补事实类
 * 条目，最后按原有先后顺序输出。这是画像层与记忆层的关键区别——旧偏好比新事实更
 * 值得留。
 */
export function enforceLimit(
  entries: readonly UserModelEntry[],
  limit: number = USER_CHAR_LIMIT,
): UserModelEntry[] {
  const seen = new Set<string>()
  const unique: Array<{ entry: UserModelEntry; index: number }> = []
  for (const [index, entry] of entries.entries()) {
    const key = normalizeForDedupe(entry.value)
    if (seen.has(key)) continue
    seen.add(key)
    unique.push({ entry, index })
  }

  const cost = (entry: UserModelEntry) => entry.value.length + SEP.length
  const total = unique.reduce((sum, item) => sum + cost(item.entry), 0)
  if (total <= limit) return unique.map((item) => item.entry)

  const preferred = unique.filter((item) => isPreferenceEntry(item.entry.value))
  const factual = unique.filter((item) => !isPreferenceEntry(item.entry.value))

  const kept = new Set<number>()
  let budget = 0

  for (const item of preferred) {
    const itemCost = cost(item.entry)
    if (budget + itemCost > limit) continue
    budget += itemCost
    kept.add(item.index)
  }
  for (let i = factual.length - 1; i >= 0; i--) {
    const item = factual[i]!
    const itemCost = cost(item.entry)
    if (budget + itemCost > limit) continue
    budget += itemCost
    kept.add(item.index)
  }

  return unique.filter((item) => kept.has(item.index)).map((item) => item.entry)
}

/** 追加一条画像条目：去重、执行上限、原子落盘。返回落盘后的全部条目。 */
export async function writeUserModel(entry: string): Promise<UserModelEntry[]> {
  const value = entry.trim()
  if (value.length === 0) return readUserModel()

  const existing = await readUserModel()
  const next = enforceLimit([...existing, { key: `user_${existing.length}`, value, tags: value.match(/#\w+/g) ?? [] }])

  await mkdir(memoryDir(), { recursive: true })
  await atomicWrite(userModelPath(), next.map((item) => item.value).join(SEP) + SEP)
  cached = undefined
  return next
}

/**
 * 渲染成系统提示片段。空画像返回 undefined（不注入空段落）。
 * 与记忆段用不同的标签包裹，便于模型区分「这是谁」与「发生过什么」。
 */
export function formatUserModelForPrompt(
  entries: readonly UserModelEntry[],
  budget: number = USER_MODEL_INJECTION_BUDGET,
): string | undefined {
  if (entries.length === 0) return undefined

  const lines: string[] = []
  let total = 0
  for (const entry of entries) {
    const line = `${entry.value}\n`
    if (total + line.length > budget && lines.length > 0) break
    lines.push(line)
    total += line.length
  }
  if (lines.length === 0) return undefined

  return ["<about-owner>", "谷总画像（跨会话累积）：", ...lines.map((line) => `- ${line.trimEnd()}`), "</about-owner>"].join(
    "\n",
  )
}
