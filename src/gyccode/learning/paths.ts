// 技能沉淀闭环的路径解析与命名校验。
// 本文件是纯函数模块：不触碰文件系统、不缓存状态，所有路径函数都接受 root 参数以便单测隔离。
import path from "path"
import { homedir } from "os"

/** 技能目录下允许存在的三类支持文件目录，与 Hermes 的类级命名约定保持一致。 */
export const SUPPORT_DIRS = ["references", "templates", "scripts"] as const

export type SupportDir = (typeof SUPPORT_DIRS)[number]

/** 禁止用作技能名前缀的「一次性动作」词：它们描述的是某次具体处置，不是可复用能力。 */
const BANNED_PREFIXES = ["fix", "debug", "audit", "patch", "hotfix", "pr", "issue"] as const

/** 禁止作为完整分段的时效性词：逐段比对，避免误杀 templates / known-how 这类正常命名。 */
const BANNED_SEGMENTS = ["today", "now", "temp", "tmp"] as const

const DATE_PATTERN = /\d{4}-\d{2}-\d{2}/
const KEBAB_PATTERN = /^[a-z0-9]+(-[a-z0-9]+)*$/
const SUPPORT_SEGMENT_PATTERN = /^[A-Za-z0-9._-]+$/
const WINDOWS_DRIVE_PATTERN = /^[A-Za-z]:/

/**
 * 沉淀闭环的技能家目录。
 *
 * 刻意**不**采纳 HERMES_HOME：那是 Hermes Agent 自己的 home，其 skills/ 是它的
 * 技能库、.usage.json 是它自己的结构。沿用会把 gyc 的自建技能写进别人的库，
 * 并误读其用量账本。GYCCODE_MEMORY_HOME 仍可覆盖，便于把记忆与技能统一到同一根。
 */
export function gycSkillsHome(root?: string): string {
  if (root !== undefined && root.length > 0) return root
  return (
    process.env.GYCCODE_SKILLS_HOME || process.env.GYCCODE_MEMORY_HOME || path.join(homedir(), ".gyc")
  )
}

/** $GYC_HOME/skills */
export function skillsRoot(root?: string): string {
  return path.join(gycSkillsHome(root), "skills")
}

/** $GYC_HOME/skills_archived */
export function archiveRoot(root?: string): string {
  return path.join(gycSkillsHome(root), "skills_archived")
}

/** $GYC_HOME/skills/<name> */
export function skillDir(root: string | undefined, name: string): string {
  return path.join(skillsRoot(root), name)
}

/** $GYC_HOME/skills/<name>/SKILL.md */
export function skillFile(root: string | undefined, name: string): string {
  return path.join(skillDir(root, name), "SKILL.md")
}

/** $GYC_HOME/skills/.usage.json */
export function usagePath(root?: string): string {
  return path.join(skillsRoot(root), ".usage.json")
}

/** $GYC_HOME/skills/.ledger.jsonl */
export function ledgerPath(root?: string): string {
  return path.join(skillsRoot(root), ".ledger.jsonl")
}

/** $GYC_HOME/skills/.blobs —— 内容寻址的正文存储目录。 */
export function blobsDir(root?: string): string {
  return path.join(skillsRoot(root), ".blobs")
}

/** $GYC_HOME/skills/.learning-state.json */
export function learningStatePath(root?: string): string {
  return path.join(skillsRoot(root), ".learning-state.json")
}

/**
 * 技能名合法：kebab-case、非空，且不是一次性动作或临时命名。
 * 之所以要挡住这些，是为了杜绝把「某次修复的速记」沉淀成技能，污染可复用的能力库。
 */
export function isValidSkillName(name: unknown): name is string {
  if (typeof name !== "string" || name.length === 0) return false
  if (!KEBAB_PATTERN.test(name)) return false
  if (DATE_PATTERN.test(name)) return false
  if (BANNED_PREFIXES.some((prefix) => name.startsWith(`${prefix}-`))) return false
  const segments = name.split("-")
  return !segments.some((segment) => (BANNED_SEGMENTS as readonly string[]).includes(segment))
}

/**
 * 支持文件路径合法：必须是 references/ templates/ scripts/ 之下的相对路径。
 * 绝对路径、反斜杠、驱动器号、`..` 逃逸、空分段一律拒绝。
 */
export function isValidSupportPath(relPath: unknown): relPath is string {
  if (typeof relPath !== "string" || relPath.length === 0) return false
  if (relPath.includes("\\") || relPath.includes("\0")) return false
  if (relPath.startsWith("/") || relPath.startsWith("~")) return false
  if (path.isAbsolute(relPath) || WINDOWS_DRIVE_PATTERN.test(relPath)) return false

  const segments = relPath.split("/")
  // 至少要「支持目录 + 文件名」两段
  if (segments.length < 2) return false
  if (segments.some((segment) => segment.length === 0 || segment === "." || segment === "..")) {
    return false
  }

  const [head, ...rest] = segments
  if (!(SUPPORT_DIRS as readonly string[]).includes(head)) return false
  return rest.every((segment) => SUPPORT_SEGMENT_PATTERN.test(segment))
}
