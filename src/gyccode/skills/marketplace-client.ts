// Skill Marketplace Client — 技能市场客户端
// 支持技能发布、搜索、安装、版本对比、依赖解析

import { readFile, writeFile, mkdir, readdir, stat, cp, rm } from "fs/promises"
import path from "path"
import { AgentJson, AgentJsonSchema, validateAgentJson } from "./agent-schema.js"

// ────────────────────── 类型定义 ──────────────────────

export interface MarketplaceSkillEntry {
  id: string
  name: string
  version: string
  description?: string
  category: AgentJson["category"]
  author?: string
  tags: string[]
  dependencies: string[]
  mcp_servers: string[]
  status: "active" | "deprecated" | "archived" | "experimental"
  license?: string
  localPath: string
  publishedAt: string
}

export interface MarketplaceIndex {
  name: string
  version: string
  description: string
  lastUpdated: string
  skills: MarketplaceSkillEntry[]
}

export interface SearchResult {
  skill: MarketplaceSkillEntry
  score: number
  matchReason: string
}

export interface InstallResult {
  success: boolean
  skillId: string
  installedPath: string
  version: string
  dependenciesInstalled: string[]
  errors: string[]
}

export interface PublishResult {
  success: boolean
  skillId: string
  version: string
  message: string
}

export interface VersionDiff {
  skillId: string
  currentVersion: string
  latestVersion: string
  isUpgradable: boolean
  breakingChanges: string[]
}

// ────────────────────── 常量 ──────────────────────

const SKILLS_ROOT = path.join(process.cwd(), "src", "gyccode", "skills")
const MARKETPLACE_INDEX = path.join(process.cwd(), "skills", "marketplace", "index.json")

// ────────────────────── 市场注册表操作 ──────────────────────

async function readMarketplaceIndex(): Promise<MarketplaceIndex> {
  try {
    const raw = await readFile(MARKETPLACE_INDEX, "utf-8")
    return JSON.parse(raw) as MarketplaceIndex
  } catch {
    return {
      name: "gyc-code-skills-marketplace",
      version: "1.0.0",
      description: "gyc-code 技能市场本地注册表",
      lastUpdated: new Date().toISOString(),
      skills: [],
    }
  }
}

async function writeMarketplaceIndex(index: MarketplaceIndex): Promise<void> {
  await mkdir(path.dirname(MARKETPLACE_INDEX), { recursive: true })
  await writeFile(MARKETPLACE_INDEX, JSON.stringify(index, null, 2) + "\n", "utf-8")
}

// ────────────────────── 发布 ──────────────────────

export async function publishSkill(skillDir: string): Promise<PublishResult> {
  const agentJsonPath = path.join(skillDir, "agent.json")
  try {
    const raw = await readFile(agentJsonPath, "utf-8")
    const parsed = JSON.parse(raw)
    const agentJson = validateAgentJson(parsed)

    const index = await readMarketplaceIndex()
    const existingIdx = index.skills.findIndex(s => s.id === agentJson.id)

    const entry: MarketplaceSkillEntry = {
      id: agentJson.id,
      name: agentJson.name,
      version: agentJson.version,
      description: agentJson.description,
      category: agentJson.category,
      author: agentJson.author,
      tags: agentJson.tags,
      dependencies: agentJson.dependencies,
      mcp_servers: agentJson.mcp_servers,
      status: agentJson.status,
      license: agentJson.license,
      localPath: path.relative(process.cwd(), skillDir),
      publishedAt: new Date().toISOString(),
    }

    if (existingIdx >= 0) {
      index.skills[existingIdx] = entry
    } else {
      index.skills.push(entry)
    }

    index.lastUpdated = new Date().toISOString()
    await writeMarketplaceIndex(index)

    return {
      success: true,
      skillId: agentJson.id,
      version: agentJson.version,
      message: existingIdx >= 0 ? "已更新" : "已发布",
    }
  } catch (error) {
    return {
      success: false,
      skillId: path.basename(skillDir),
      version: "unknown",
      message: `发布失败: ${error instanceof Error ? error.message : String(error)}`,
    }
  }
}

// ────────────────────── 搜索 ──────────────────────

export async function searchSkills(
  query: string,
  options: {
    category?: AgentJson["category"]
    tags?: string[]
    status?: MarketplaceSkillEntry["status"]
    limit?: number
  } = {}
): Promise<SearchResult[]> {
  const { category, tags, status, limit = 20 } = options
  const index = await readMarketplaceIndex()
  const queryLower = query.toLowerCase()
  const tokens = queryLower.split(/[^\p{L}\p{N}]+/u).filter(t => t.length >= 2)

  const results: SearchResult[] = []

  for (const skill of index.skills) {
    if (category && skill.category !== category) continue
    if (status && skill.status !== status) continue
    if (tags && !tags.some(t => skill.tags.includes(t))) continue

    let score = 0
    const reasons: string[] = []

    // ID 精确匹配
    if (skill.id.toLowerCase() === queryLower) {
      score += 100
      reasons.push("ID精确匹配")
    }

    // ID 包含
    if (skill.id.toLowerCase().includes(queryLower)) {
      score += 50
      reasons.push("ID包含")
    }

    // 名称匹配
    if (skill.name.toLowerCase().includes(queryLower)) {
      score += 40
      reasons.push("名称匹配")
    }

    // 描述匹配
    if (skill.description?.toLowerCase().includes(queryLower)) {
      score += 30
      reasons.push("描述匹配")
    }

    // 标签匹配
    for (const token of tokens) {
      if (skill.tags.some(t => t.includes(token))) {
        score += 20
        reasons.push(`标签匹配: ${token}`)
      }
    }

    // Token 匹配
    for (const token of tokens) {
      if (skill.id.toLowerCase().includes(token)) score += 10
      if (skill.name.toLowerCase().includes(token)) score += 8
      if (skill.description?.toLowerCase().includes(token)) score += 5
    }

    if (score > 0) {
      results.push({
        skill,
        score,
        matchReason: reasons.join("; ") || "模糊匹配",
      })
    }
  }

  results.sort((a, b) => b.score - a.score)
  return results.slice(0, limit)
}

// ────────────────────── 安装 ──────────────────────

export async function installSkill(
  skillId: string,
  options: {
    version?: string
    force?: boolean
  } = {}
): Promise<InstallResult> {
  const index = await readMarketplaceIndex()
  const skill = index.skills.find(s => s.id === skillId)

  if (!skill) {
    return {
      success: false,
      skillId,
      installedPath: "",
      version: "",
      dependenciesInstalled: [],
      errors: [`技能 ${skillId} 未在市场中找到`],
    }
  }

  if (options.version && skill.version !== options.version) {
    return {
      success: false,
      skillId,
      installedPath: "",
      version: skill.version,
      dependenciesInstalled: [],
      errors: [`请求版本 ${options.version}，市场中只有 ${skill.version}`],
    }
  }

  const targetDir = path.join(SKILLS_ROOT, skillId)
  const sourceDir = path.resolve(process.cwd(), skill.localPath)

  // 检查是否已安装
  try {
    await stat(targetDir)
    if (!options.force) {
      return {
        success: false,
        skillId,
        installedPath: targetDir,
        version: skill.version,
        dependenciesInstalled: [],
        errors: [`技能 ${skillId} 已安装在 ${targetDir}，使用 --force 覆盖`],
      }
    }
    await rm(targetDir, { recursive: true, force: true })
  } catch {
    // 未安装，继续
  }

  // 复制技能目录
  try {
    await mkdir(targetDir, { recursive: true })
    await cp(sourceDir, targetDir, { recursive: true })
  } catch (error) {
    return {
      success: false,
      skillId,
      installedPath: targetDir,
      version: skill.version,
      dependenciesInstalled: [],
      errors: [`复制失败: ${error instanceof Error ? error.message : String(error)}`],
    }
  }

  // 解析依赖
  const depsInstalled: string[] = []
  const depsErrors: string[] = []

  for (const dep of skill.dependencies) {
    const depSkill = index.skills.find(s => s.id === dep)
    if (depSkill) {
      const depResult = await installSkill(dep, { force: options.force })
      if (depResult.success) {
        depsInstalled.push(dep)
      } else {
        depsErrors.push(...depResult.errors)
      }
    } else {
      depsErrors.push(`依赖 ${dep} 未在市场中找到`)
    }
  }

  return {
    success: true,
    skillId,
    installedPath: targetDir,
    version: skill.version,
    dependenciesInstalled: depsInstalled,
    errors: depsErrors,
  }
}

// ────────────────────── 更新检查 ──────────────────────

export async function checkForUpdates(): Promise<VersionDiff[]> {
  const index = await readMarketplaceIndex()
  const diffs: VersionDiff[] = []

  for (const skill of index.skills) {
    const agentJsonPath = path.join(process.cwd(), skill.localPath, "agent.json")
    try {
      const raw = await readFile(agentJsonPath, "utf-8")
      const local = validateAgentJson(JSON.parse(raw))

      if (local.version !== skill.version) {
        diffs.push({
          skillId: skill.id,
          currentVersion: local.version,
          latestVersion: skill.version,
          isUpgradable: compareVersions(skill.version, local.version) > 0,
          breakingChanges: [],
        })
      }
    } catch {
      // 本地未安装，跳过
    }
  }

  return diffs
}

// ────────────────────── 依赖解析 ──────────────────────

export async function resolveDependencies(
  skillIds: string[]
): Promise<{ ordered: string[]; missing: string[]; circular: string[][] }> {
  const index = await readMarketplaceIndex()
  const skillMap = new Map(index.skills.map(s => [s.id, s]))
  const visited = new Set<string>()
  const visiting = new Set<string>()
  const ordered: string[] = []
  const missing: string[] = []
  const circular: string[][] = []

  function visit(id: string, stack: string[]): boolean {
    if (visited.has(id)) return true
    if (visiting.has(id)) {
      const cycleStart = stack.indexOf(id)
      if (cycleStart >= 0) {
        circular.push([...stack.slice(cycleStart), id])
      }
      return false
    }

    const skill = skillMap.get(id)
    if (!skill) {
      missing.push(id)
      return false
    }

    visiting.add(id)
    stack.push(id)

    for (const dep of skill.dependencies) {
      visit(dep, stack)
    }

    stack.pop()
    visiting.delete(id)
    visited.add(id)
    ordered.push(id)
    return true
  }

  for (const id of skillIds) {
    visit(id, [])
  }

  return { ordered, missing, circular }
}

// ────────────────────── 列出所有技能 ──────────────────────

export async function listSkills(): Promise<MarketplaceSkillEntry[]> {
  const index = await readMarketplaceIndex()
  return index.skills
}

// ────────────────────── 工具函数 ──────────────────────

function compareVersions(a: string, b: string): number {
  const pa = a.split(".").map(Number)
  const pb = b.split(".").map(Number)
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const na = pa[i] || 0
    const nb = pb[i] || 0
    if (na > nb) return 1
    if (na < nb) return -1
  }
  return 0
}
