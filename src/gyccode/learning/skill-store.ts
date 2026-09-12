// 技能存储：$GYC_HOME/skills 下唯一允许的读写入口，装上两道闸门。
// 闸门一（provenance）：只有「agent 自建且未被钉住」的技能可改写，手写或外部安装的技能只读。
// 闸门二（read-before-write）：改技能或覆盖已存在的支持文件前，必须在本轮里先读过对应文件。
// 容错原则：语义拒绝与文件系统错误一律转成 ok:false 的结构化结果，异常绝不抛给调用方。
import { mkdir, readFile, readdir, rename, stat, writeFile } from "fs/promises"
import path from "path"
import { appendEntry, snapshotSkill } from "./ledger"
import type { FileSnapshot } from "./ledger"
import { archiveRoot, isValidSkillName, isValidSupportPath, skillDir, skillFile, skillsRoot } from "./paths"
import { bumpPatch, isWritable, readUsage, resetCreated, setState } from "./usage"

export interface SkillInfo {
  name: string
  description: string
  body: string
  files: string[]
}

export type RejectReason =
  | "invalid-name"
  | "already-exists"
  | "not-found"
  | "not-writable"
  | "read-before-write"
  | "invalid-support-path"
  | "invalid-content"

export type ApplyResult = { ok: true } | { ok: false; reason: RejectReason; message: string }

export interface SkillStore {
  list(): Promise<string[]>
  read(name: string): Promise<SkillInfo | undefined>
  readSupportFile(name: string, rel: string): Promise<string | undefined>
  create(input: {
    name: string
    description: string
    body: string
    sessionId: string
  }): Promise<ApplyResult>
  patch(input: {
    name: string
    description?: string
    body?: string
    sessionId: string
  }): Promise<ApplyResult>
  writeSupportFile(input: {
    name: string
    filePath: string
    content: string
    sessionId: string
  }): Promise<ApplyResult>
  archive(input: { name: string; sessionId: string; reason: string }): Promise<ApplyResult>
  restore(input: { name: string; sessionId: string }): Promise<ApplyResult>
}

const ACTOR = "agent"

function ok(): ApplyResult {
  return { ok: true }
}

function reject(reason: RejectReason, message: string): ApplyResult {
  return { ok: false, reason, message }
}

/** 把任意异常收敛成一条拒绝原因：错误码本身留在 message 里，方便事后追查。 */
function reasonForError(error: unknown): RejectReason {
  const code = (error as { code?: unknown } | null | undefined)?.code
  if (code === "ENOENT") return "not-found"
  if (code === "EEXIST" || code === "ENOTEMPTY") return "already-exists"
  if (code === "EACCES" || code === "EPERM" || code === "EROFS") return "not-writable"
  // 其余（EBUSY / EMFILE / 盘符异常等）归到最接近的语义桶，细节由 message 承载
  return "invalid-content"
}

function describeError(error: unknown): string {
  if (error instanceof Error) {
    const code = (error as { code?: unknown }).code
    return typeof code === "string" ? `文件系统错误 ${code}：${error.message}` : error.message
  }
  return `未知错误：${String(error)}`
}

/** 统一兜底：任何一步抛错都变成结构化拒绝。 */
async function guard(task: () => Promise<ApplyResult>): Promise<ApplyResult> {
  try {
    return await task()
  } catch (error) {
    return reject(reasonForError(error), describeError(error))
  }
}

async function pathExists(target: string): Promise<boolean> {
  try {
    await stat(target)
    return true
  } catch {
    return false
  }
}

/** 快照与 SkillInfo 内的路径统一用正斜杠相对路径，跟账本口径一致。 */
function toPosix(relPath: string): string {
  return relPath.split(path.sep).join("/")
}

/** 递归收集技能目录下的相对路径；目录缺失时返回 []。 */
async function collectFiles(base: string, dir: string): Promise<string[]> {
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
      files.push(...(await collectFiles(base, full)))
    } else if (entry.isFile()) {
      files.push(toPosix(path.relative(base, full)))
    }
  }
  return files.sort()
}

/** 技能名只允许单段目录名：挡掉 ../ 之类的越级读取。 */
function isSafeSegment(name: unknown): name is string {
  if (typeof name !== "string" || name.length === 0) return false
  if (name.includes("/") || name.includes("\\") || name === "." || name === "..") return false
  return !name.includes("\0")
}

/** 描述压成单行，避免换行把 YAML frontmatter 撕成两半。 */
function oneLine(text: string): string {
  return text.replace(/\r?\n/g, " ").trim()
}

function trimEdgeNewlines(text: string): string {
  return text.replace(/^\n+/, "").replace(/\n+$/, "")
}

/** 生成 SKILL.md：必须带 name + description 的 frontmatter，供 gyc 技能发现器识别。 */
function formatSkillFile(name: string, description: string, body: string): string {
  const head = `---\nname: ${name}\ndescription: ${oneLine(description)}\n---\n`
  const trimmed = trimEdgeNewlines(body.replace(/\r\n/g, "\n"))
  return trimmed.length === 0 ? `${head}\n` : `${head}\n${trimmed}\n`
}

/** 解析 SKILL.md：拿不到 frontmatter 时 description 为空、body 视为整份内容。 */
function parseSkillFile(raw: string): { description: string; body: string } {
  const text = raw.replace(/\r\n/g, "\n")
  const lines = text.split("\n")
  if (lines[0]?.trim() !== "---") return { description: "", body: trimEdgeNewlines(text) }

  let closing = -1
  for (let index = 1; index < lines.length; index += 1) {
    if (lines[index]?.trim() === "---") {
      closing = index
      break
    }
  }
  if (closing === -1) return { description: "", body: trimEdgeNewlines(text) }

  let description = ""
  for (const line of lines.slice(1, closing)) {
    const matched = /^description\s*:\s*(.*)$/.exec(line)
    if (matched !== null) {
      description = (matched[1] ?? "").trim()
      break
    }
  }
  return { description, body: trimEdgeNewlines(lines.slice(closing + 1).join("\n")) }
}

export function make(root: string): SkillStore {
  // 本轮已读过的文件绝对路径；patch 与覆盖支持文件时据此放行
  const readMark = new Set<string>()

  function markRead(target: string): void {
    readMark.add(path.resolve(target))
  }

  async function list(): Promise<string[]> {
    let entries
    try {
      entries = await readdir(skillsRoot(root), { withFileTypes: true })
    } catch {
      return []
    }
    const names: string[] = []
    for (const entry of entries) {
      // 点开头的都是内部账本/快照目录，不算技能
      if (!entry.isDirectory() || entry.name.startsWith(".")) continue
      if (!(await pathExists(skillFile(root, entry.name)))) continue
      names.push(entry.name)
    }
    return names.sort()
  }

  async function read(name: string): Promise<SkillInfo | undefined> {
    if (!isSafeSegment(name)) return undefined
    const file = skillFile(root, name)
    let raw: string
    try {
      raw = await readFile(file, "utf-8")
    } catch {
      return undefined
    }
    markRead(file)
    const parsed = parseSkillFile(raw)
    return {
      name,
      description: parsed.description,
      body: parsed.body,
      files: await collectFiles(skillDir(root, name), skillDir(root, name)),
    }
  }

  async function readSupportFile(name: string, rel: string): Promise<string | undefined> {
    if (!isSafeSegment(name) || !isValidSupportPath(rel)) return undefined
    const target = path.join(skillDir(root, name), ...rel.split("/"))
    try {
      const content = await readFile(target, "utf-8")
      markRead(target)
      return content
    } catch {
      return undefined
    }
  }

  async function create(input: {
    name: string
    description: string
    body: string
    sessionId: string
  }): Promise<ApplyResult> {
    return guard(async () => {
      const { name, description, body, sessionId } = input
      if (!isValidSkillName(name)) {
        return reject("invalid-name", `技能名 ${name} 不是可复用的类级 kebab-case 命名`)
      }
      const dir = skillDir(root, name)
      if (await pathExists(dir)) return reject("already-exists", `技能 ${name} 已经存在，改用 patch`)

      // 目录此刻确认不存在（上面已判），所以这是全新技能：无条件重置用量条目，不合并旧值。
      // 若沿用「仅当条目缺失才建档」，会把「目录已删但 .usage.json 还留着」的中间态
      // 继承过来——旧条目若是 pinned 或 origin=user，新技能此后每次改写都会被
      // not-writable 无声拒掉。
      await resetCreated(root, name, ACTOR)

      const before = await snapshotSkill(root, name)
      await mkdir(dir, { recursive: true })
      await writeFile(skillFile(root, name), formatSkillFile(name, description, body), "utf-8")
      const after = await snapshotSkill(root, name)
      await appendEntry(root, { actor: ACTOR, action: "create", skill: name, sessionId, before, after })
      return ok()
    })
  }

  async function patch(input: {
    name: string
    description?: string
    body?: string
    sessionId: string
  }): Promise<ApplyResult> {
    return guard(async () => {
      const { name, sessionId } = input
      const file = skillFile(root, name)
      if (!(await pathExists(file))) return reject("not-found", `技能 ${name} 不存在`)

      const entry = (await readUsage(root))[name]
      if (entry === undefined || !isWritable(entry)) {
        return reject("not-writable", `技能 ${name} 不归 agent 所有或已被钉住，只读`)
      }
      if (!readMark.has(path.resolve(file))) {
        return reject("read-before-write", `改写 ${name} 前必须先读取它的 SKILL.md`)
      }
      if (input.description === undefined && input.body === undefined) {
        return reject("invalid-content", "description 与 body 至少要给一个")
      }

      const current = parseSkillFile(await readFile(file, "utf-8"))
      const nextDescription = input.description ?? current.description
      const nextBody = input.body ?? current.body

      const before = await snapshotSkill(root, name)
      await writeFile(file, formatSkillFile(name, nextDescription, nextBody), "utf-8")
      const after = await snapshotSkill(root, name)
      await appendEntry(root, { actor: ACTOR, action: "patch", skill: name, sessionId, before, after })
      await bumpPatch(root, name)
      return ok()
    })
  }

  async function writeSupportFile(input: {
    name: string
    filePath: string
    content: string
    sessionId: string
  }): Promise<ApplyResult> {
    return guard(async () => {
      const { name, filePath, content, sessionId } = input
      if (!isValidSupportPath(filePath)) {
        return reject("invalid-support-path", `支持文件路径 ${filePath} 必须落在 references/templates/scripts 之下`)
      }
      const dir = skillDir(root, name)
      if (!(await pathExists(dir))) return reject("not-found", `技能 ${name} 不存在`)

      const entry = (await readUsage(root))[name]
      if (entry === undefined || !isWritable(entry)) {
        return reject("not-writable", `技能 ${name} 不归 agent 所有或已被钉住，只读`)
      }

      const target = path.join(dir, ...filePath.split("/"))
      // 新增文件无需先读；覆盖已有文件必须先在 readSupportFile 里读过
      if ((await pathExists(target)) && !readMark.has(path.resolve(target))) {
        return reject("read-before-write", `覆盖 ${filePath} 前必须先读它`)
      }

      const before = await snapshotSkill(root, name)
      await mkdir(path.dirname(target), { recursive: true })
      await writeFile(target, content, "utf-8")
      const after = await snapshotSkill(root, name)
      await appendEntry(root, {
        actor: ACTOR,
        action: "write_file",
        skill: name,
        sessionId,
        before,
        after,
      })
      await bumpPatch(root, name)
      return ok()
    })
  }

  async function archive(input: {
    name: string
    sessionId: string
    reason: string
  }): Promise<ApplyResult> {
    // input.reason 是 curator 给的归档缘由，只用于调用方日志：账本条目结构固定为
    // sessionId + before/after，这里不另开字段，避免私改 Task 3 已定的账本格式。
    return guard(async () => {
      const { name, sessionId } = input
      const dir = skillDir(root, name)
      if (!(await pathExists(dir))) return reject("not-found", `技能 ${name} 不存在`)
      // provenance 闸门：搬走一个技能同样是改写它。谷总手写或已钉住的技能不许被
      // 自动流程归档——需要归档时先显式解除钉住，这是两步骤、正是钉住的意义。
      if (!isWritable((await readUsage(root))[name])) {
        return reject("not-writable", `技能 ${name} 不是自建技能或已被钉住，不能归档`)
      }

      const before = await snapshotSkill(root, name)
      const stamp = new Date().toISOString().replace(/[:.]/g, "")
      const destination = path.join(archiveRoot(root), `${name}-${stamp}`)
      await mkdir(archiveRoot(root), { recursive: true })
      await rename(dir, destination)
      await setState(root, name, "archived")
      await appendEntry(root, {
        actor: ACTOR,
        action: "archive",
        skill: name,
        sessionId,
        before,
        after: [] satisfies FileSnapshot[],
      })
      return ok()
    })
  }

  async function restore(input: { name: string; sessionId: string }): Promise<ApplyResult> {
    return guard(async () => {
      const { name, sessionId } = input
      // 归档根不存在时按空目录处理：恢复一个从未归档过的技能应当得到 not-found，
      // 而不是把 ENOENT 抛给调用方。
      const entries = await readdir(archiveRoot(root), { withFileTypes: true }).catch(() => [])
      const backups = entries
        .filter((entry) => entry.isDirectory() && entry.name.startsWith(`${name}-`))
        .map((entry) => entry.name)
        .sort()
      const latest = backups[backups.length - 1]
      if (latest === undefined) return reject("not-found", `归档区里没有 ${name} 的备份`)

      const dir = skillDir(root, name)
      if (await pathExists(dir)) return reject("already-exists", `技能 ${name} 已存在，无需恢复`)
      // 与 archive 对称：恢复也是改写，同样要过 provenance 闸门。
      if (!isWritable((await readUsage(root))[name])) {
        return reject("not-writable", `技能 ${name} 不是自建技能或已被钉住，不能恢复`)
      }

      await mkdir(skillsRoot(root), { recursive: true })
      await rename(path.join(archiveRoot(root), latest), dir)
      await setState(root, name, "active")
      const after = await snapshotSkill(root, name)
      await appendEntry(root, {
        actor: ACTOR,
        action: "restore",
        skill: name,
        sessionId,
        before: [] satisfies FileSnapshot[],
        after,
      })
      return ok()
    })
  }

  return { list, read, readSupportFile, create, patch, writeSupportFile, archive, restore }
}
