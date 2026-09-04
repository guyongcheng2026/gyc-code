import { Effect } from "effect"
import { readFile, readdir, stat } from "fs/promises"
import path from "path"
import { AgentJson, AgentJsonSchema, SkillManifest, validateAgentJson, validateSkillManifest } from "./agent-schema.js"

export interface SkillInfo extends AgentJson {
  skillPath: string
  agentMdPath: string
  knowledgePaths: {
    public: string
    private: string
  }
  rulePaths: {
    public: string
    private: string
  }
  modelPath: string
  subagentPath: string
  templatesPath: string
  loadedAt: Date
}

export interface SkillLoadResult {
  skills: Map<string, SkillInfo>
  manifest: SkillManifest
  errors: Array<{ skillId: string; error: Error }>
}

const SKILLS_ROOT = path.join(process.cwd(), "src", "gyccode", "skills")
const MARKETPLACE_ROOT = path.join(process.cwd(), "skills", "marketplace")

export async function discoverSkills(roots: string[] = [SKILLS_ROOT]): Promise<string[]> {
  const skillDirs: string[] = []

  for (const root of roots) {
    try {
      const entries = await readdir(root, { withFileTypes: true })
      for (const entry of entries) {
        if (entry.isDirectory()) {
          const skillPath = path.join(root, entry.name)
          const agentJsonPath = path.join(skillPath, "agent.json")
          try {
            await stat(agentJsonPath)
            skillDirs.push(skillPath)
          } catch {
            // 没有 agent.json 不是技能目录
          }
        }
      }
    } catch {
      // 目录不存在，忽略
    }
  }

  return skillDirs
}

export const loadSkill = (skillPath: string): Effect.Effect<SkillInfo, Error> =>
  Effect.gen(function* () {
    const agentJsonPath = path.join(skillPath, "agent.json")
    const agentMdPath = path.join(skillPath, "agent.md")

    const rawJson = yield* Effect.promise(() => readFile(agentJsonPath, "utf-8"))
    const parsed = JSON.parse(rawJson)
    const agentJson = validateAgentJson(parsed)

    // 验证 agent.md 存在
    yield* Effect.promise(() => stat(agentMdPath)).pipe(
      Effect.catch(() => Effect.fail(new Error(`Missing agent.md: ${agentMdPath}`)))
    )

    // 构建子目录路径
    const knowledgePaths = {
      public: path.join(skillPath, "KNOWLEDGE", "PUBLIC"),
      private: path.join(skillPath, "KNOWLEDGE", "PRIVATE"),
    }
    const rulePaths = {
      public: path.join(skillPath, "RULE", "PUBLIC"),
      private: path.join(skillPath, "RULE", "PRIVATE"),
    }
    const modelPath = path.join(skillPath, "MODEL")
    const subagentPath = path.join(skillPath, "SUBAGENT")
    const templatesPath = path.join(skillPath, "TEMPLATES")

    return {
      ...agentJson,
      skillPath,
      agentMdPath,
      knowledgePaths,
      rulePaths,
      modelPath,
      subagentPath,
      templatesPath,
      loadedAt: new Date(),
    } as SkillInfo
  })

// 使用 Effect.match 替代 Effect.either
const loadSkillEither = (skillPath: string) =>
  Effect.match(loadSkill(skillPath), {
    onFailure: (error) => ({ _tag: "Left" as const, left: error }),
    onSuccess: (value) => ({ _tag: "Right" as const, right: value }),
  })

export const loadAllSkills = (roots?: string[]): Effect.Effect<SkillLoadResult, never> =>
  Effect.gen(function* () {
    const skillDirs = yield* Effect.promise(() => discoverSkills(roots))
    const skills = new Map<string, SkillInfo>()
    const errors: Array<{ skillId: string; error: Error }> = []

    for (const dir of skillDirs) {
      const result = yield* loadSkillEither(dir)
      if (result._tag === "Right") {
        skills.set(result.right.id, result.right)
      } else {
        const skillId = path.basename(dir)
        errors.push({ skillId, error: result.left })
      }
    }

    const manifest: SkillManifest = {
      skills: Array.from(skills.values()).map(s => ({
        id: s.id,
        name: s.name,
        main: s.main,
        description: s.description,
        version: s.version,
        author: s.author,
        category: s.category,
        dependencies: s.dependencies,
        mcp_servers: s.mcp_servers,
        usage: s.usage,
        status: s.status,
        tags: s.tags,
        homepage: s.homepage,
        repository: s.repository,
        license: s.license,
      })),
      lastUpdated: new Date().toISOString(),
      version: "1.0.0",
    }

    return { skills, manifest, errors }
  })

export function getSkill(skills: Map<string, SkillInfo>, id: string): SkillInfo | undefined {
  return skills.get(id)
}

export function getSkillsByCategory(skills: Map<string, SkillInfo>, category: SkillInfo["category"]): SkillInfo[] {
  return Array.from(skills.values()).filter(s => s.category === category)
}

export function getActiveSkills(skills: Map<string, SkillInfo>): SkillInfo[] {
  return Array.from(skills.values()).filter(s => s.status === "active")
}

export function resolveDependencies(
  skills: Map<string, SkillInfo>,
  skillIds: string[]
): { ordered: SkillInfo[]; missing: string[]; circular: string[][] } {
  const visited = new Set<string>()
  const visiting = new Set<string>()
  const ordered: SkillInfo[] = []
  const missing: string[] = []
  const circular: string[][] = []

  function visit(id: string, stack: string[]): boolean {
    if (visited.has(id)) return true
    if (visiting.has(id)) {
      // 发现循环
      const cycleStart = stack.indexOf(id)
      if (cycleStart >= 0) {
        circular.push([...stack.slice(cycleStart), id])
      }
      return false
    }

    const skill = skills.get(id)
    if (!skill) {
      missing.push(id)
      return false
    }

    visiting.add(id)
    stack.push(id)

    for (const dep of skill.dependencies) {
      if (!visit(dep, stack)) {
        // 依赖缺失或循环，继续处理其他依赖
      }
    }

    stack.pop()
    visiting.delete(id)
    visited.add(id)
    ordered.push(skill)
    return true
  }

  for (const id of skillIds) {
    visit(id, [])
  }

  return { ordered, missing, circular }
}

export interface KnowledgeEntry {
  skillId: string
  layer: "public" | "private"
  file: string
  content: string
}

export const loadKnowledgeBase = (skill: SkillInfo): Effect.Effect<KnowledgeEntry[], never> =>
  Effect.gen(function* () {
    const entries: KnowledgeEntry[] = []

    for (const layer of ["public", "private"] as const) {
      const dir = skill.knowledgePaths[layer]
      try {
        const files = yield* Effect.promise(() => readdir(dir))
        for (const file of files) {
          if (file.endsWith(".md") || file.endsWith(".txt")) {
            const content = yield* Effect.promise(() => readFile(path.join(dir, file), "utf-8"))
            entries.push({ skillId: skill.id, layer, file, content })
          }
        }
      } catch {
        // 目录不存在或为空，忽略
      }
    }

    return entries
  })

export interface RuleEntry {
  skillId: string
  layer: "public" | "private"
  file: string
  content: string
}

export const loadRules = (skill: SkillInfo): Effect.Effect<RuleEntry[], never> =>
  Effect.gen(function* () {
    const entries: RuleEntry[] = []

    for (const layer of ["public", "private"] as const) {
      const dir = skill.rulePaths[layer]
      try {
        const files = yield* Effect.promise(() => readdir(dir))
        for (const file of files) {
          if (file.endsWith(".md") || file.endsWith(".txt")) {
            const content = yield* Effect.promise(() => readFile(path.join(dir, file), "utf-8"))
            entries.push({ skillId: skill.id, layer, file, content })
          }
        }
      } catch {
        // 忽略
      }
    }

    return entries
  })

export const loadTemplates = (skill: SkillInfo): Effect.Effect<Map<string, string>, never> =>
  Effect.gen(function* () {
    const templates = new Map<string, string>()
    try {
      const files = yield* Effect.promise(() => readdir(skill.templatesPath))
      for (const file of files) {
        if (file.endsWith(".template") || file.endsWith(".tmpl") || file.endsWith(".md")) {
          const content = yield* Effect.promise(() => readFile(path.join(skill.templatesPath, file), "utf-8"))
          templates.set(file.replace(/\.(template|tmpl)$/, ""), content)
        }
      }
    } catch {
      // 忽略
    }
    return templates
  })