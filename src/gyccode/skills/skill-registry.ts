import { Effect, Layer, Ref, Context } from "effect"
import { SkillInfo, SkillLoadResult, loadAllSkills, getSkill, getActiveSkills, resolveDependencies, loadKnowledgeBase, loadRules, loadTemplates, KnowledgeEntry, RuleEntry } from "./skill-loader.js"
export type { SkillInfo, KnowledgeEntry, RuleEntry } from "./skill-loader.js"
import { AgentJson } from "./agent-schema.js"

export interface SkillRegistry {
  readonly loadAll: Effect.Effect<SkillLoadResult, never>
  readonly getSkill: (id: string) => Effect.Effect<SkillInfo | undefined, never>
  readonly getActiveSkills: () => Effect.Effect<SkillInfo[], never>
  readonly getSkillsByCategory: (category: AgentJson["category"]) => Effect.Effect<SkillInfo[], never>
  readonly resolveDependencies: (skillIds: string[]) => Effect.Effect<{
    ordered: SkillInfo[]
    missing: string[]
    circular: string[][]
  }, never>
  readonly loadKnowledgeBase: (skillId: string) => Effect.Effect<KnowledgeEntry[], never>
  readonly loadRules: (skillId: string) => Effect.Effect<RuleEntry[], never>
  readonly loadTemplates: (skillId: string) => Effect.Effect<Map<string, string>, never>
  readonly refresh: () => Effect.Effect<void, never>
}

export class SkillRegistryService extends Context.Service<SkillRegistryService, SkillRegistry>()("@gyccode/SkillRegistry") {}

const makeSkillRegistry = Effect.gen(function* () {
  const stateRef = yield* Ref.make<SkillLoadResult | null>(null)

  const loadAll = Effect.gen(function* () {
    const result = yield* loadAllSkills()
    yield* Ref.set(stateRef, result)
    return result
  })

  const getSkillById = (id: string) =>
    Effect.gen(function* () {
      const state = yield* Ref.get(stateRef)
      if (!state) return undefined
      return getSkill(state.skills, id)
    })

  const getAllActiveSkills = () =>
    Effect.gen(function* () {
      const state = yield* Ref.get(stateRef)
      if (!state) return []
      return getActiveSkills(state.skills)
    })

  const getSkillsByCategory = (category: AgentJson["category"]) =>
    Effect.gen(function* () {
      const state = yield* Ref.get(stateRef)
      if (!state) return []
      const skills = Array.from(state.skills.values()).filter(s => s.category === category && s.status === "active")
      return skills
    })

  const resolveSkillDependencies = (skillIds: string[]) =>
    Effect.gen(function* () {
      const state = yield* Ref.get(stateRef)
      if (!state) return { ordered: [], missing: skillIds, circular: [] }
      return resolveDependencies(state.skills, skillIds)
    })

  const loadSkillKnowledgeBase = (skillId: string) =>
    Effect.gen(function* () {
      const state = yield* Ref.get(stateRef)
      if (!state) return []
      const skill = state.skills.get(skillId)
      if (!skill) return []
      return yield* loadKnowledgeBase(skill)
    })

  const loadSkillRules = (skillId: string) =>
    Effect.gen(function* () {
      const state = yield* Ref.get(stateRef)
      if (!state) return []
      const skill = state.skills.get(skillId)
      if (!skill) return []
      return yield* loadRules(skill)
    })

  const loadSkillTemplates = (skillId: string) =>
    Effect.gen(function* () {
      const state = yield* Ref.get(stateRef)
      if (!state) return new Map()
      const skill = state.skills.get(skillId)
      if (!skill) return new Map()
      return yield* loadTemplates(skill)
    })

  const refresh = () => loadAll.pipe(Effect.asVoid)

  return {
    loadAll,
    getSkill: getSkillById,
    getActiveSkills: getAllActiveSkills,
    getSkillsByCategory,
    resolveDependencies: resolveSkillDependencies,
    loadKnowledgeBase: loadSkillKnowledgeBase,
    loadRules: loadSkillRules,
    loadTemplates: loadSkillTemplates,
    refresh,
  }
})

export const SkillRegistryLive = Layer.effect(SkillRegistryService, makeSkillRegistry)

export const SkillRegistryTest = (initialState: SkillLoadResult) =>
  Layer.succeed(
    SkillRegistryService,
    (() => {
      let state = initialState
      return {
        loadAll: Effect.succeed(state),
        getSkill: (id: string) => Effect.succeed(state?.skills.get(id)),
        getActiveSkills: () => Effect.succeed(Array.from(state?.skills.values() || []).filter(s => s.status === "active")),
        getSkillsByCategory: (category: AgentJson["category"]) =>
          Effect.succeed(Array.from(state?.skills.values() || []).filter(s => s.category === category && s.status === "active")),
        resolveDependencies: (skillIds: string[]) =>
          Effect.succeed(state ? resolveDependencies(state.skills, skillIds) : { ordered: [], missing: skillIds, circular: [] }),
        loadKnowledgeBase: (skillId: string) =>
          Effect.succeed(state?.skills.get(skillId) ? loadKnowledgeBase(state.skills.get(skillId)!) : Promise.resolve([])),
        loadRules: (skillId: string) =>
          Effect.succeed(state?.skills.get(skillId) ? loadRules(state.skills.get(skillId)!) : Promise.resolve([])),
        loadTemplates: (skillId: string) =>
          Effect.succeed(state?.skills.get(skillId) ? loadTemplates(state.skills.get(skillId)!) : Promise.resolve(new Map())),
        refresh: Effect.sync(() => { state = { skills: new Map(), manifest: { skills: [], lastUpdated: new Date().toISOString(), version: "1.0.0" }, errors: [] } }),
      }
    })()
  )