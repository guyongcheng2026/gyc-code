import { LayerNode } from "@gyccode/core/effect/layer-node"
import { Context, Effect, Layer } from "effect"

import { InstanceState } from "@/effect/instance-state"

import PROMPT_ANTHROPIC from "./prompt/anthropic.txt"
import PROMPT_DEFAULT from "./prompt/default.txt"
import PROMPT_BEAST from "./prompt/beast.txt"
import PROMPT_GEMINI from "./prompt/gemini.txt"
import PROMPT_GPT from "./prompt/gpt.txt"
import PROMPT_KIMI from "./prompt/kimi.txt"

import PROMPT_CODEX from "./prompt/codex.txt"
import PROMPT_TRINITY from "./prompt/trinity.txt"
import type { Provider } from "@/provider/provider"
import type { Agent } from "@/agent/agent"
import { Permission } from "@/permission"
import { Skill } from "@/skill"
import { AbsolutePath } from "@gyccode/core/schema"
import { Location } from "@gyccode/core/location"
import { LocationServiceMap, locationServiceMapLayer } from "@gyccode/core/location-services"
import { Reference } from "@gyccode/core/reference"
import { MCP } from "@/mcp"
import { PermissionV1 } from "@gyccode/core/v1/permission"
import {
  formatMemoriesForPrompt,
  searchMemories,
  getMemoryAgeMs,
  MEMORY_INJECTION_BUDGET,
} from "../memory/memory-bridge"

export function provider(model: Provider.Model) {
  if (model.api.id.includes("gpt-4") || model.api.id.includes("o1") || model.api.id.includes("o3"))
    return [PROMPT_BEAST]
  if (model.api.id.includes("gpt")) {
    if (model.api.id.includes("codex")) {
      return [PROMPT_CODEX]
    }
    return [PROMPT_GPT]
  }
  if (model.api.id.includes("gemini-")) return [PROMPT_GEMINI]
  if (model.api.id.includes("claude")) return [PROMPT_ANTHROPIC]
  if (model.api.id.toLowerCase().includes("trinity")) return [PROMPT_TRINITY]
  if (model.api.id.toLowerCase().includes("kimi")) return [PROMPT_KIMI]
  return [PROMPT_DEFAULT]
}

export interface Interface {
  readonly environment: (model: Provider.Model) => Effect.Effect<string[]>
  readonly skills: (agent: Agent.Info) => Effect.Effect<string | undefined>
  readonly mcp: (agent: Agent.Info, permission?: PermissionV1.Ruleset) => Effect.Effect<string | undefined>
  readonly memory: (query: string, sessionID: string) => Effect.Effect<string | undefined>
}

export class Service extends Context.Service<Service, Interface>()("@gyccode/SystemPrompt") {}

const layer = Layer.effect(
  Service,
  Effect.gen(function* () {
    const skill = yield* Skill.Service
    const mcp = yield* MCP.Service
    const locations = yield* LocationServiceMap.Service

    // 会话级记忆缓存：同一会话内固定记忆注入，避免随每条消息的检索 query
    // 变化破坏系统提示的字节稳定性（prompt-cache 前缀友好）。
    const memoryCache = new Map<string, { time: number; value: string | undefined }>()
    const MEMORY_CACHE_TTL_MS = 30 * 60 * 1000
    const MEMORY_CACHE_MAX = 64

    return Service.of({
      environment: Effect.fn("SystemPrompt.environment")(function* (model: Provider.Model) {
        const ctx = yield* InstanceState.context
        const references = yield* Effect.gen(function* () {
          return (yield* (yield* Reference.Service).list()).filter((reference) => reference.description !== undefined)
        }).pipe(Effect.provide(locations.get(Location.Ref.make({ directory: AbsolutePath.make(ctx.directory) }))))
        return [
          [
            `You are powered by the model named ${model.api.id}. The exact model ID is ${model.providerID}/${model.api.id}`,
            `Here is some useful information about the environment you are running in:`,
            `<env>`,
            `  Working directory: ${ctx.directory}`,
            `  Workspace root folder: ${ctx.worktree}`,
            `  Is directory a git repo: ${ctx.project.vcs === "git" ? "yes" : "no"}`,
            `  Platform: ${process.platform}`,
            `</env>`,
          ].join("\n"),
          references.length === 0
            ? undefined
            : [
                "Project references provide additional directories that can be accessed when relevant.",
                "<available_references>",
                ...references
                  .toSorted((a, b) => a.name.localeCompare(b.name))
                  .flatMap((reference) => [
                    "  <reference>",
                    `    <name>${reference.name}</name>`,
                    `    <path>${reference.path}</path>`,
                    ...(reference.description === undefined
                      ? []
                      : [`    <description>${reference.description}</description>`]),
                    "  </reference>",
                  ]),
                "</available_references>",
              ].join("\n"),
        ].filter((part): part is string => part !== undefined)
      }),

      skills: Effect.fn("SystemPrompt.skills")(function* (agent: Agent.Info) {
        if (Permission.disabled(["skill"], agent.permission).has("skill")) return

        const list = yield* skill.available(agent)

        return [
          "Skills provide specialized instructions and workflows for specific tasks.",
          "Use the skill tool to load a skill when a task matches its description.",
          Skill.fmt(list, { verbose: false }),
        ].join("\n")
      }),

      mcp: Effect.fn("SystemPrompt.mcp")(function* (agent: Agent.Info, permission?: PermissionV1.Ruleset) {
        const ruleset = Permission.merge(agent.permission, permission ?? [])
        const instructions = (yield* mcp.instructions()).filter(
          (item) => item.tools.length === 0 || Permission.disabled(item.tools, ruleset).size < item.tools.length,
        )
        if (instructions.length === 0) return

        // MCP 指令总长预算：防止服务器指令无上限膨胀系统提示词
        const maxInstructions = 4_096
        const blocks: string[] = []
        let total = 0
        for (const item of instructions) {
          const block = [
            `  <server name="${item.name}">`,
            ...item.instructions.split("\n").map((line) => `    ${line}`),
            "  </server>",
          ].join("\n")
          if (blocks.length === 0 || total + block.length <= maxInstructions) {
            blocks.push(block)
            total += block.length
          } else {
            break
          }
        }

        return [
          "<mcp_instructions>",
          ...blocks,
          "</mcp_instructions>",
        ].join("\n")
      }),

      memory: Effect.fn("SystemPrompt.memory")(function* (query: string, sessionID: string) {
        const cached = memoryCache.get(sessionID)
        if (cached) {
          if (Date.now() - cached.time < MEMORY_CACHE_TTL_MS) {
            // LRU refresh: move the hit entry to the most-recently-used slot.
            memoryCache.delete(sessionID)
            memoryCache.set(sessionID, cached)
            return cached.value
          }
          memoryCache.delete(sessionID) // expired entry; drop before recompute
        }
        if (!query.trim()) return
        const entries = yield* Effect.promise(() => searchMemories(query))
        if (entries.length > 0) {
          // Per-turn retrieval detail; DEBUG keeps the default log quiet.
          yield* Effect.logDebug("SystemPrompt.memory", { query: query.slice(0, 80), hits: entries.length })
        }
        const ageMs = yield* Effect.promise(() => getMemoryAgeMs())
        const value = formatMemoriesForPrompt(entries, MEMORY_INJECTION_BUDGET, ageMs)
        // LRU eviction: drop only the least-recently-used entry instead of
        // clearing the whole cache, which would tank the hit rate.
        if (memoryCache.size >= MEMORY_CACHE_MAX) {
          const oldest = memoryCache.keys().next().value
          if (oldest !== undefined) memoryCache.delete(oldest)
        }
        memoryCache.set(sessionID, { time: Date.now(), value })
        return value
      }),
    })
  }),
)

const locationServiceMapNode = LayerNode.make({
  service: LocationServiceMap.Service,
  layer: locationServiceMapLayer,
  deps: [],
})

export const node = LayerNode.make({
  service: Service,
  layer: layer,
  deps: [Skill.node, MCP.node, locationServiceMapNode],
})

export * as SystemPrompt from "./system"
