import { Effect } from "effect"
import { mkdir, readFile, rename, rm, writeFile } from "fs/promises"
import path from "path"
import { homedir } from "os"
import { shouldDream, formatDreamPrompt, analyzeDreamResult, DEFAULT_DREAM_CONFIG, type DreamConfig, type DreamState } from "./dream"

/** Persist dream state next to the hermes memory file. */
const DREAM_STATE_PATH = path.join(
  process.env.HERMES_HOME || path.join(homedir(), ".gyc"),
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
    }
  } catch {
    return { lastDreamAt: 0, sessionsSinceDream: 0, memoryCount: 0 }
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
}

/**
 * One dream step: advance the session counter, and when the threshold is hit,
 * synthesize accumulated memories into a structured summary persisted back to
 * durable storage. Pure wrapper - every side effect is injected. Returns the
 * next dream state; the caller persists it via writeDreamState.
 */
export function maybeDream(options: MaybeDreamOptions): Effect.Effect<DreamState> {
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

    yield* options.writeMemory(result.summary)
    yield* Effect.logInfo("dream synthesis complete", {
      topicCount: result.topicCount,
      actionItemCount: result.actionItemCount,
    })
    return { lastDreamAt: Date.now(), sessionsSinceDream: 0, memoryCount: options.memoryCount }
  })
}