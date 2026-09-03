import { Effect } from "effect"
import { mkdir, readFile, rename, rm, writeFile } from "fs/promises"
import path from "path"
import { homedir } from "os"
import {
  shouldDream,
  formatDreamPrompt,
  analyzeDreamResult,
  validateDreamResult,
  DEFAULT_DREAM_CONFIG,
  type DreamConfig,
  type DreamState,
  validatedMaybeDream,
  type ValidatedDreamOptions,
} from "./dream"
import { enforceStandardCompliance } from "../mcp/standard-elements"

/** Persist dream state next to the memory file. */
const DREAM_STATE_PATH = path.join(
  process.env.GYCCODE_MEMORY_HOME || process.env.HERMES_HOME || path.join(homedir(), ".gyc"),
  "memory",
  "dream-state.json",
)

/** 原子写：先写临时文件再 rename，避免进程中断时产生半写损坏的 JSON。 */
async function atomicWriteFile(filePath: string, content: string): Promise<void> {
  const tmpPath = `${filePath}.tmp.${Date.now()}`
  await writeFile(tmpPath, content, "utf-8")
  try {
    await rename(tmpPath, filePath)
  } catch (error) {
    // 不遗留半写的 .tmp 孤儿文件
    // 临时文件可能已被清理，删除失败不阻断
    await rm(tmpPath, { force: true }).catch(() => {})
    throw error
  }
}

export async function readDreamState(): Promise<DreamState> {
  try {
    const raw = await readFile(DREAM_STATE_PATH, "utf-8")
    const parsed = JSON.parse(raw) as Partial<DreamState>
    return {
      lastDreamAt: typeof parsed.lastDreamAt === "number" ? parsed.lastDreamAt : 0,
      sessionsSinceDream: typeof parsed.sessionsSinceDream === "number" ? parsed.sessionsSinceDream : 0,
      memoryCount: typeof parsed.memoryCount === "number" ? parsed.memoryCount : 0,
      lastDreamQuality: typeof parsed.lastDreamQuality === "number" ? parsed.lastDreamQuality : undefined,
      retryCount: typeof parsed.retryCount === "number" ? parsed.retryCount : 0,
    }
  } catch {
    return { lastDreamAt: 0, sessionsSinceDream: 0, memoryCount: 0, retryCount: 0 }
  }
}

export async function writeDreamState(state: DreamState): Promise<void> {
  await mkdir(path.dirname(DREAM_STATE_PATH), { recursive: true })
  await atomicWriteFile(DREAM_STATE_PATH, JSON.stringify(state, null, 2) + "\n")
}

/** Injected: turns the synthesized-summary prompt into a summary (LLM call). */
export type DreamSynthesizer = (input: { prompt: string }) => Effect.Effect<string>

export interface MaybeDreamOptions {
  readonly state: DreamState
  readonly memoryCount: number
  /** Raw accumulated memory texts, joined; passed to the synthesizer prompt. */
  readonly memories: string
  readonly config?: DreamConfig
  readonly synthesizer: DreamSynthesizer
  /** Injected: persists the synthesized summary back to durable storage. */
  readonly writeMemory: (value: string) => Effect.Effect<void>
  /** Use validated dream with retry logic (default: true) */
  readonly useValidation?: boolean
  /** Enforce standard compliance on dream output */
  readonly enforceStandards?: boolean
}

/**
 * One dream step: advance the session counter, and when the threshold is hit,
 * synthesize accumulated memories into a structured summary persisted back to
 * durable storage. Pure wrapper - every side effect is injected. Returns the
 * next dream state; the caller persists it via writeDreamState.
 */
export function maybeDream(options: MaybeDreamOptions): Effect.Effect<DreamState> {
  const useValidation = options.useValidation ?? true
  const enforceStandards = options.enforceStandards ?? true

  if (useValidation) {
    const baseOptions: ValidatedDreamOptions = {
      state: options.state,
      memoryCount: options.memoryCount,
      memories: options.memories,
      config: options.config,
      synthesizer: options.synthesizer,
      writeMemory: enforceStandards
        ? (value: string) =>
            Effect.gen(function* () {
              // Enforce standard compliance before writing
              const compliantValue = yield* Effect.tryPromise({
                try: () => enforceStandardCompliance(value, "rule", 3),
                catch: () => value, // 合规失败时保留原值
              })
              yield* options.writeMemory(compliantValue)
            })
        : options.writeMemory,
    }
    return validatedMaybeDream(baseOptions)
  }

  // Legacy non-validated path
  const config = options.config ?? DEFAULT_DREAM_CONFIG
  return Effect.gen(function* () {
    const candidate: DreamState = {
      ...options.state,
      memoryCount: options.memoryCount,
      sessionsSinceDream: options.state.sessionsSinceDream + 1,
    }
    if (!shouldDream(candidate, config)) return candidate

    const prompt = formatDreamPrompt(options.memories)
    const raw = yield* options.synthesizer({ prompt })
    const result = analyzeDreamResult(raw)

    let finalSummary = result.summary
    if (enforceStandards) {
      finalSummary = yield* Effect.tryPromise({
        try: () => enforceStandardCompliance(result.summary, "rule", 3),
        catch: () => result.summary,
      })
    }

    yield* options.writeMemory(finalSummary)
    yield* Effect.logInfo("dream synthesis complete", {
      topicCount: result.topicCount,
      actionItemCount: result.actionItemCount,
      qualityScore: result.qualityScore,
    })
    return { lastDreamAt: Date.now(), sessionsSinceDream: 0, memoryCount: options.memoryCount, lastDreamQuality: result.qualityScore }
  })
}

/** Run dream validation on existing content without synthesis */
export function validateDream(content: string, config: DreamConfig = DEFAULT_DREAM_CONFIG) {
  return validateDreamResult(content, config)
}