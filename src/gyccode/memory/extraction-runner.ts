import { Effect } from "effect"
import type { MemoryEntry } from "./memory-bridge"
import { deduplicateMemories } from "./extract"
import { enforceStandardCompliance } from "../mcp/standard-elements"

export interface ExtractionConfig {
  minTurns: number
  model: string
  maxMemories: number
  /** Enable MCP standard compliance enforcement */
  enforceStandards?: boolean
  /** Standard element type for compliance checking */
  standardType?: "rule" | "pattern" | "config"
}

export interface ExtractionInput {
  readonly conversation: string
  readonly existing: readonly MemoryEntry[]
  readonly config: ExtractionConfig
}

/** Injected: turns a conversation into candidate memory lines (LLM call). */
export type Extractor = (input: ExtractionInput) => Effect.Effect<string[]>

/** Injected: persists new memories to durable storage. */
export type MemorySink = (memories: readonly string[]) => Effect.Effect<number>

export interface RunOptions {
  readonly extractor: Extractor
  readonly sink: MemorySink
  readonly existing: readonly MemoryEntry[]
  readonly conversation: string
  readonly config: ExtractionConfig
}

/**
 * Run one memory-extraction step: ask the extractor for candidate memories,
 * filter out ones already present (case-insensitive substring), enforce standards,
 * cap to maxMemories, then persist. Pure wrapper — all I/O is injected.
 */
export function runExtraction(options: RunOptions): Effect.Effect<string[]> {
  return Effect.gen(function* () {
    const candidates = yield* options.extractor({
      conversation: options.conversation,
      existing: options.existing,
      config: options.config,
    })
    const fresh = candidates.filter((candidate) => deduplicateMemories(options.existing, candidate))
    const capped = fresh.slice(0, options.config.maxMemories)

    if (capped.length > 0) {
      // Enforce standard compliance before persisting
      let toPersist = capped
      if (options.config.enforceStandards && options.config.standardType) {
        toPersist = yield* Effect.forEach(
          capped,
          (memory) =>
            Effect.tryPromise({
              try: () => enforceStandardCompliance(memory, options.config.standardType!, 3),
              // 合规失败以原文兜底（不把合规错误外溢、也不中断其它条目的处理）
              catch: () => memory,
            }).pipe(Effect.orElseSucceed(() => memory)),
          { concurrency: "unbounded" },
        )
      }
      yield* options.sink(toPersist)
    }
    return capped
  })
}

/**
 * Default sink: 按内容分流落盘。
 *
 * 偏好 / 风格 / 交互约定进画像层，事实与决策进会话记忆文件。分流判据只有一处
 * （user-model 的 classifyMemoryTarget），避免两套规则各自演化后漂移。
 */
export const memorySink: MemorySink = (memories) =>
  Effect.promise(async () => {
    const { writeMemoryFile } = await import("./memory-bridge")
    const { classifyMemoryTarget, writeUserModel } = await import("./user-model")
    let count = 0
    for (const content of memories) {
      if (classifyMemoryTarget(content) === "user") {
        await writeUserModel(content)
      } else {
        await writeMemoryFile({ key: `extract_${Date.now()}_${count}`, value: content + "\n" }, true)
      }
      count++
    }
    return count
  })