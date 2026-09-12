// 技能用量与生命周期账本：$GYC_HOME/skills/.usage.json
// 容错原则：读失败（缺失/损坏）一律返回空表；写失败静默降级 —— 用量统计是遥测，绝不阻塞技能写入。
// 效果反馈只记「次数 + 最后活动时间 + 被改写次数 + 生命周期状态」，不引入成功率之类的派生指标。
import { mkdir, readFile, rename, rm, writeFile } from "fs/promises"
import path from "path"
import { isValidSkillName, usagePath } from "./paths"

export type SkillOrigin = "agent" | "user"

export type SkillState = "active" | "stale" | "archived"

export interface SkillUsageEntry {
  origin: SkillOrigin
  state: SkillState
  pinned: boolean
  useCount: number
  viewCount: number
  patchCount: number
  createdAt: number
  lastActivityAt: number
}

export type SkillUsageTable = Record<string, SkillUsageEntry>

const ORIGINS: readonly string[] = ["agent", "user"]
const STATES: readonly string[] = ["active", "stale", "archived"]

function pick<T extends string>(value: unknown, allowed: readonly string[], fallback: T): T {
  return typeof value === "string" && allowed.includes(value) ? (value as T) : fallback
}

function count(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) && value >= 0 ? value : 0
}

/** 逐字段校正磁盘上的条目：坏字段回落默认值，避免一处损坏波及整份账本。 */
function parseEntry(value: unknown): SkillUsageEntry | undefined {
  if (value === null || typeof value !== "object" || Array.isArray(value)) return undefined
  const raw = value as Record<string, unknown>
  return {
    origin: pick<SkillOrigin>(raw.origin, ORIGINS, "agent"),
    state: pick<SkillState>(raw.state, STATES, "active"),
    pinned: raw.pinned === true,
    useCount: count(raw.useCount),
    viewCount: count(raw.viewCount),
    patchCount: count(raw.patchCount),
    createdAt: count(raw.createdAt),
    lastActivityAt: count(raw.lastActivityAt),
  }
}

function emptyEntry(origin: SkillOrigin, now: number): SkillUsageEntry {
  return {
    origin,
    state: "active",
    pinned: false,
    useCount: 0,
    viewCount: 0,
    patchCount: 0,
    createdAt: now,
    lastActivityAt: now,
  }
}

/** 读取整份用量表；任何失败都退化为空表。 */
export async function readUsage(root?: string): Promise<SkillUsageTable> {
  try {
    const raw = await readFile(usagePath(root), "utf-8")
    const parsed: unknown = JSON.parse(raw)
    if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) return {}
    const table: SkillUsageTable = {}
    for (const [name, value] of Object.entries(parsed as Record<string, unknown>)) {
      const entry = parseEntry(value)
      if (entry !== undefined) table[name] = entry
    }
    return table
  } catch {
    return {}
  }
}

// 进程内并发读改写必须串行化：本模块自身不加锁依赖，用一个模块级 Promise 队列把
// 「读 → 改 → 写」串成一条链；链上任何一环失败都不会污染后续任务的执行。
let writeQueue: Promise<unknown> = Promise.resolve()

function serialize<T>(task: () => Promise<T>): Promise<T> {
  const run = writeQueue.then(task, task)
  writeQueue = run.then(
    () => undefined,
    () => undefined,
  )
  return run
}

/** 临时文件 + rename 原子替换；JSON 以换行结尾，键按字典序稳定输出。 */
async function writeUsage(root: string | undefined, table: SkillUsageTable): Promise<void> {
  const file = usagePath(root)
  await mkdir(path.dirname(file), { recursive: true })
  const ordered: SkillUsageTable = {}
  for (const name of Object.keys(table).sort()) {
    const entry = table[name]
    if (entry !== undefined) ordered[name] = entry
  }
  const tmp = `${file}.tmp.${process.pid}.${Date.now()}`
  try {
    await writeFile(tmp, JSON.stringify(ordered, null, 2) + "\n", "utf-8")
    await rename(tmp, file)
  } catch (error) {
    // 清理可能残留的临时文件；清理失败不影响调用方
    await rm(tmp, { force: true }).catch(() => {})
    throw error
  }
}

/**
 * 读改写一次用量表。
 * 非法技能名不落盘，只返回一份内存结果；整条链路不向调用方抛异常。
 */
async function mutate(
  root: string | undefined,
  name: string,
  apply: (entry: SkillUsageEntry, now: number) => SkillUsageEntry,
): Promise<SkillUsageEntry> {
  const now = Date.now()
  if (!isValidSkillName(name)) return apply(emptyEntry("agent", now), now)

  return serialize(async () => {
    let next = emptyEntry("agent", now)
    try {
      const table = await readUsage(root)
      const previous = table[name]
      next = apply(previous === undefined ? emptyEntry("agent", now) : { ...previous }, now)
      table[name] = next
      await writeUsage(root, table)
    } catch {
      // 静默降级：磁盘写不进去时仍把内存中的结果交给调用方
    }
    return next
  })
}

/** 登记一个新沉淀的技能；已存在时保留原有计数与 createdAt。 */
export async function recordCreated(
  root: string | undefined,
  name: string,
  origin: SkillOrigin = "agent",
): Promise<SkillUsageEntry> {
  return mutate(root, name, (entry, now) => ({
    ...entry,
    origin,
    lastActivityAt: now,
    createdAt: entry.createdAt > 0 ? entry.createdAt : now,
  }))
}

/**
 * 无条件重置一条用量条目（**不**合并旧值）。
 *
 * create 场景专用：磁盘上目录已不存在，说明这是全新技能，残留的 pinned / origin /
 * state 都属于上一个同名技能，必须丢弃。否则新技能会继承 origin=user 或 pinned，
 * 此后每次改写都被 not-writable 无声拒掉。
 */
export async function resetCreated(
  root: string | undefined,
  name: string,
  origin: SkillOrigin = "agent",
): Promise<SkillUsageEntry> {
  return mutate(root, name, (_entry, now) => ({
    origin,
    state: "active",
    pinned: false,
    useCount: 0,
    viewCount: 0,
    patchCount: 0,
    createdAt: now,
    lastActivityAt: now,
  }))
}

export async function bumpView(
  root: string | undefined,
  name: string,
): Promise<SkillUsageEntry> {
  return mutate(root, name, (entry, now) => ({
    ...entry,
    viewCount: entry.viewCount + 1,
    lastActivityAt: now,
  }))
}

export async function bumpUse(root: string | undefined, name: string): Promise<SkillUsageEntry> {
  return mutate(root, name, (entry, now) => ({
    ...entry,
    useCount: entry.useCount + 1,
    lastActivityAt: now,
  }))
}

export async function bumpPatch(
  root: string | undefined,
  name: string,
): Promise<SkillUsageEntry> {
  return mutate(root, name, (entry, now) => ({
    ...entry,
    patchCount: entry.patchCount + 1,
    lastActivityAt: now,
  }))
}

export async function setState(
  root: string | undefined,
  name: string,
  state: SkillState,
): Promise<SkillUsageEntry> {
  return mutate(root, name, (entry) => ({ ...entry, state }))
}

export async function setPinned(
  root: string | undefined,
  name: string,
  pinned: boolean,
): Promise<SkillUsageEntry> {
  return mutate(root, name, (entry) => ({ ...entry, pinned }))
}

/** 可否被自动改写：只动 agent 自己沉淀、且未被钉住的技能。 */
export function isWritable(entry: SkillUsageEntry): boolean {
  return entry.origin === "agent" && !entry.pinned
}
