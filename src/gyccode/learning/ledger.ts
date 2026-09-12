// 技能变更账本：$GYC_HOME/skills/.ledger.jsonl（追加式一行一条）+ $GYC_HOME/skills/.blobs（内容寻址快照仓）。
// 设计取舍：
// 1) 记账是遥测——appendEntry 任何失败都吞掉，绝不因为写不进账本而阻断技能写入；
// 2) 回滚是唯一的 fail-closed 操作——账本里查不到 id 就直接抛错，绝不假装回滚成功；
// 3) 快照里的文件正文按 sha256 只存一份，回滚时从 .blobs 读回，保证「记了什么就能还原什么」。
import { createHash, randomBytes } from "crypto"
import { mkdir, readFile, readdir, rename, rm, stat, writeFile } from "fs/promises"
import path from "path"
import { blobsDir, ledgerPath, skillDir } from "./paths"

export interface FileSnapshot {
  path: string
  sha256: string
}

export interface LedgerEntry {
  id: string
  ts: string
  actor: "agent" | "curator" | "user"
  action: "create" | "patch" | "write_file" | "archive" | "restore"
  skill: string
  evidence: { sessionId: string }
  before: FileSnapshot[]
  after: FileSnapshot[]
}

/** 文件正文摘要，统一按 UTF-8 计算，与快照、回滚两侧保持同一口径。 */
export function sha256(content: string): string {
  return createHash("sha256").update(content, "utf-8").digest("hex")
}

/** 快照内一律使用正斜杠相对路径，避免同一技能在不同平台上产生两套账。 */
function toPosix(relPath: string): string {
  return relPath.split(path.sep).join("/")
}

/** 递归收集目录下全部文件；目录不存在或读不动时返回已收集到的部分，绝不抛错。 */
async function collectFiles(dir: string): Promise<string[]> {
  let entries
  try {
    entries = await readdir(dir, { withFileTypes: true })
  } catch {
    return []
  }
  const files: string[] = []
  for (const entry of entries) {
    const full = path.join(dir, entry.name)
    if (entry.isDirectory()) {
      files.push(...(await collectFiles(full)))
    } else if (entry.isFile()) {
      files.push(full)
    }
  }
  return files
}

/** 把正文写进内容寻址仓库；同 sha256 已存在则跳过，相同内容全局只存一份。 */
async function putBlob(root: string, hash: string, content: string): Promise<void> {
  const target = path.join(blobsDir(root), hash)
  try {
    await stat(target)
    return
  } catch {
    // 不存在（或探测失败）即继续写入
  }
  await mkdir(blobsDir(root), { recursive: true })
  await writeFile(target, content, "utf-8")
}

/**
 * 给技能目录拍一份快照：递归遍历全部文件，正文进 .blobs，返回相对路径 + sha256。
 * 技能目录不存在返回 []（而不是抛错）；读不出来的文件跳过。
 */
export async function snapshotSkill(root: string, name: string): Promise<FileSnapshot[]> {
  const base = skillDir(root, name)
  const files = await collectFiles(base)
  const snapshots: FileSnapshot[] = []
  for (const file of files) {
    let content: string
    try {
      content = await readFile(file, "utf-8")
    } catch {
      continue
    }
    const hash = sha256(content)
    try {
      await putBlob(root, hash, content)
    } catch {
      // 存 blob 失败不影响本次快照的元信息：账本仍然记录摘要，回滚时再暴露缺失
    }
    snapshots.push({ path: toPosix(path.relative(base, file)), sha256: hash })
  }
  return snapshots.sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0))
}

export interface AppendInput {
  actor: LedgerEntry["actor"]
  action: LedgerEntry["action"]
  skill: string
  sessionId: string
  before: FileSnapshot[]
  after: FileSnapshot[]
}

/**
 * 追加一条账目。返回 id 始终可用；写盘失败（目录不可写、路径被占等）一律吞掉，
 * 因为账本是遥测，不能反向阻断技能写入。
 */
export async function appendEntry(root: string, input: AppendInput): Promise<string> {
  const id = randomBytes(6).toString("hex")
  const entry: LedgerEntry = {
    id,
    ts: new Date().toISOString(),
    actor: input.actor,
    action: input.action,
    skill: input.skill,
    evidence: { sessionId: input.sessionId },
    before: input.before,
    after: input.after,
  }
  try {
    const file = ledgerPath(root)
    await mkdir(path.dirname(file), { recursive: true })
    await writeFile(file, JSON.stringify(entry) + "\n", { encoding: "utf-8", flag: "a" })
  } catch {
    // 吞掉：账本写不进去也不影响调用方
  }
  return id
}

/** 逐行解析账本：读不到文件返回 []，坏行跳过而不是整份作废。 */
export async function readLedger(root: string): Promise<LedgerEntry[]> {
  let raw: string
  try {
    raw = await readFile(ledgerPath(root), "utf-8")
  } catch {
    return []
  }
  const entries: LedgerEntry[] = []
  for (const line of raw.split("\n")) {
    const trimmed = line.trim()
    if (trimmed.length === 0) continue
    let parsed: unknown
    try {
      parsed = JSON.parse(trimmed)
    } catch {
      continue
    }
    const entry = asLedgerEntry(parsed)
    if (entry !== undefined) entries.push(entry)
  }
  return entries
}

/** 字段齐全才认账；半截的坏行同样按坏行处理。 */
function asLedgerEntry(value: unknown): LedgerEntry | undefined {
  if (value === null || typeof value !== "object" || Array.isArray(value)) return undefined
  const raw = value as Record<string, unknown>
  if (typeof raw.id !== "string" || raw.id.length === 0) return undefined
  if (typeof raw.ts !== "string") return undefined
  if (typeof raw.actor !== "string" || typeof raw.action !== "string") return undefined
  if (typeof raw.skill !== "string") return undefined
  if (!Array.isArray(raw.before) || !Array.isArray(raw.after)) return undefined
  const evidence = raw.evidence
  const sessionId =
    evidence !== null && typeof evidence === "object" && !Array.isArray(evidence)
      ? (evidence as Record<string, unknown>).sessionId
      : undefined
  if (typeof sessionId !== "string") return undefined
  return {
    id: raw.id,
    ts: raw.ts,
    actor: raw.actor as LedgerEntry["actor"],
    action: raw.action as LedgerEntry["action"],
    skill: raw.skill,
    evidence: { sessionId },
    before: raw.before as FileSnapshot[],
    after: raw.after as FileSnapshot[],
  }
}

/**
 * 回滚某条账目：先删掉本次变更新建的文件，再把 before 中的正文从 .blobs 原子写回。
 * 查不到 id 必须抛错——这是全模块唯一 fail-closed 的路径，宁可失败也不留半截状态。
 */
export async function rollbackEntry(root: string, id: string): Promise<void> {
  const entries = await readLedger(root)
  const entry = entries.find((item) => item.id === id)
  if (entry === undefined) throw new Error(`账本中不存在 id=${id} 的条目，拒绝回滚`)

  const base = skillDir(root, entry.skill)
  const known = new Set(entry.before.map((snap) => snap.path))

  // 1) 本次变更新建的文件：after 里有、before 里没有
  for (const snap of entry.after) {
    if (known.has(snap.path)) continue
    try {
      await rm(path.join(base, snap.path), { force: true })
    } catch {
      // 文件本就没了视为已达成目标
    }
  }

  // 2) before 里的每个文件：从内容寻址仓库取回正文，临时文件 + rename 原子落盘
  for (const snap of entry.before) {
    const content = await readFile(path.join(blobsDir(root), snap.sha256), "utf-8")
    const target = path.join(base, snap.path)
    await mkdir(path.dirname(target), { recursive: true })
    const tmp = `${target}.tmp.${process.pid}.${Date.now()}`
    await writeFile(tmp, content, "utf-8")
    await rename(tmp, target)
  }
}
