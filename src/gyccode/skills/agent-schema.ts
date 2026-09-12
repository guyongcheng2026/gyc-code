// 离线工具，不在运行时链路上：由 `scripts/archive-skills.ts` 与 `scripts/marketplace.ts` 使用，
// 校验技能市场种子内容里的 agent.json。运行时加载技能走 src/gyccode/skill/（单数），不经此处。
// src/ 内没有运行时调用方是**预期行为**，不要据此当成死代码删除。
import { z } from "zod"

export const AgentJsonSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  main: z.string().min(1),
  description: z.string().optional(),
  version: z.string().regex(/^\d+\.\d+\.\d+$/),
  author: z.string().optional(),
  category: z.enum(["development", "testing", "documentation", "analysis", "refactoring", "security", "performance"]),
  dependencies: z.array(z.string()).default([]),
  mcp_servers: z.array(z.string()).default([]),
  usage: z.array(z.string()).default([]),
  status: z.enum(["active", "deprecated", "archived", "experimental"]).default("active"),
  tags: z.array(z.string()).default([]),
  homepage: z.string().url().optional(),
  repository: z.string().url().optional(),
  license: z.string().optional(),
})

export type AgentJson = z.infer<typeof AgentJsonSchema>

export const SkillManifestSchema = z.object({
  skills: z.array(AgentJsonSchema),
  lastUpdated: z.string().datetime(),
  version: z.string().regex(/^\d+\.\d+\.\d+$/),
})

export type SkillManifest = z.infer<typeof SkillManifestSchema>

export function validateAgentJson(data: unknown): AgentJson {
  return AgentJsonSchema.parse(data)
}

export function validateSkillManifest(data: unknown): SkillManifest {
  return SkillManifestSchema.parse(data)
}