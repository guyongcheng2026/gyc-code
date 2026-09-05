import { Effect } from "effect"

export interface DreamConfig {
  /** Hours between dreams */
  minHoursBetween: number
  /** Sessions between dreams */
  minSessionsBetween: number
  /** Minimum memories to trigger dream */
  minMemories: number
  /** Maximum retry attempts for validation */
  maxRetries: number
  /** Minimum quality score to accept (0-100) */
  minQualityScore: number
  /** Required sections in dream output */
  requiredSections: string[]
}

export const DEFAULT_DREAM_CONFIG: DreamConfig = {
  minHoursBetween: 24,
  minSessionsBetween: 5,
  minMemories: 10,
  maxRetries: 3,
  minQualityScore: 70,
  requiredSections: ["Key Learnings", "Patterns & Preferences", "Action Items", "Topic Clusters"],
}

export interface DreamState {
  lastDreamAt: number  // timestamp ms
  sessionsSinceDream: number
  memoryCount: number
  lastDreamQuality?: number
  retryCount: number
}

export function shouldDream(state: DreamState, config: DreamConfig = DEFAULT_DREAM_CONFIG): boolean {
  if (state.memoryCount < config.minMemories) return false

  const hoursSince = (Date.now() - state.lastDreamAt) / (1000 * 60 * 60)
  if (state.lastDreamAt === 0) return state.sessionsSinceDream >= config.minSessionsBetween

  return hoursSince >= config.minHoursBetween || state.sessionsSinceDream >= config.minSessionsBetween
}

export function formatDreamPrompt(memories: string, config: DreamConfig = DEFAULT_DREAM_CONFIG): string {
  const sections = config.requiredSections.map(s => `## ${s}\n- `).join("\n\n")
  return `Synthesize these memories into a structured knowledge summary. You MUST include ALL of the following sections:

${sections}

Raw memories:
${memories}

Output ONLY the markdown with the required sections. No extra commentary.`
}

export function parseDreamResult(raw: string): string {
  return raw.trim()
}

export interface DreamResult {
  summary: string
  topicCount: number
  actionItemCount: number
  qualityScore: number
  validationErrors: string[]
  sectionsFound: string[]
  sectionsMissing: string[]
}

export interface ValidationResult {
  passed: boolean
  score: number
  errors: string[]
  warnings: string[]
  sectionsFound: string[]
  sectionsMissing: string[]
}

export function analyzeDreamResult(content: string): DreamResult {
  const topicMatches = content.match(/^## /gm)
  const actionMatches = content.match(/^- \[ \]/gm) ?? content.match(/^- /gm)

  const validation = validateDreamResult(content, DEFAULT_DREAM_CONFIG)

  return {
    summary: content.slice(0, 200) + "...",
    topicCount: topicMatches?.length ?? 0,
    actionItemCount: actionMatches?.length ?? 0,
    qualityScore: validation.score,
    validationErrors: validation.errors,
    sectionsFound: validation.sectionsFound,
    sectionsMissing: validation.sectionsMissing,
  }
}

export function validateDreamResult(content: string, config: DreamConfig = DEFAULT_DREAM_CONFIG): ValidationResult {
  const errors: string[] = []
  const warnings: string[] = []
  const sectionsFound: string[] = []
  const sectionsMissing: string[] = []

  // Check required sections
  for (const section of config.requiredSections) {
    const regex = new RegExp(`^##\\s+${escapeRegExp(section)}\\b`, "m")
    if (regex.test(content)) {
      sectionsFound.push(section)
    } else {
      sectionsMissing.push(section)
      errors.push(`Missing required section: ${section}`)
    }
  }

  // Check content quality
  let score = 100

  // Penalize missing sections heavily
  score -= sectionsMissing.length * 20

  // Check minimum content per section
  for (const section of sectionsFound) {
    const sectionContent = extractSection(content, section)
    if (sectionContent.trim().length < 20) {
      warnings.push(`Section "${section}" has minimal content (< 20 chars)`)
      score -= 10
    }
    if (!sectionContent.includes("-") && !sectionContent.includes("*")) {
      warnings.push(`Section "${section}" lacks bullet points`)
      score -= 5
    }
  }

  // Check for actionable items in Action Items section
  if (sectionsFound.includes("Action Items")) {
    const actionContent = extractSection(content, "Action Items")
    const actionItems = actionContent.match(/^[-*]\s+\[?\s?\]?/gm) || []
    if (actionItems.length === 0) {
      warnings.push('"Action Items" section has no actionable items')
      score -= 15
    } else if (actionItems.length < 2) {
      warnings.push('"Action Items" section has very few items')
      score -= 5
    }
  }

  // Check for topic clustering
  if (sectionsFound.includes("Topic Clusters")) {
    const clusterContent = extractSection(content, "Topic Clusters")
    const clusters = clusterContent.match(/^[-*]\s+/gm) || []
    if (clusters.length < 3) {
      warnings.push('"Topic Clusters" has few clusters')
      score -= 5
    }
  }

  // Check overall length
  if (content.trim().length < 200) {
    warnings.push("Dream output is very short (< 200 chars)")
    score -= 15
  }

  // Check for hallucination markers
  const hallucinationPatterns = [
    /as an ai/i,
    /i don't know/i,
    /i cannot/i,
    /unable to/i,
    /not sure/i,
    /maybe/i,
    /possibly/i,
  ]
  for (const pattern of hallucinationPatterns) {
    if (pattern.test(content)) {
      warnings.push("Potential hallucination/uncertainty language detected")
      score -= 10
      break
    }
  }

  score = Math.max(0, Math.min(100, score))

  return {
    passed: score >= config.minQualityScore && sectionsMissing.length === 0,
    score,
    errors,
    warnings,
    sectionsFound,
    sectionsMissing,
  }
}

function escapeRegExp(string: string): string {
  return string.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
}

function extractSection(content: string, sectionName: string): string {
  const regex = new RegExp(`^##\\s+${escapeRegExp(sectionName)}\\b([\\s\\S]*?)(?=^##\\s+|$)`, "m")
  const match = content.match(regex)
  return match ? match[1].trim() : ""
}

/** Retry dream synthesis with validation until quality threshold met */
export async function synthesizeDreamWithValidation(
  synthesizer: (prompt: string) => Promise<string>,
  memories: string,
  config: DreamConfig = DEFAULT_DREAM_CONFIG
): Promise<DreamResult> {
  let lastResult: DreamResult | null = null
  let attempt = 0

  while (attempt <= config.maxRetries) {
    const prompt = formatDreamPrompt(memories, config)
    const raw = await synthesizer(prompt)
    const result = analyzeDreamResult(raw)
    lastResult = result

    if (result.qualityScore >= config.minQualityScore && result.sectionsMissing.length === 0) {
      return result
    }

    // Add validation feedback to next prompt
    const feedback = buildValidationFeedback(result, config)
    attempt++

    if (attempt <= config.maxRetries) {
      // 继续重试，带上反馈
    }
  }

  // 返回最后一次结果（即使不合格）
  return lastResult!
}

function buildValidationFeedback(result: DreamResult, config: DreamConfig): string {
  const parts: string[] = []

  if (result.sectionsMissing.length > 0) {
    parts.push(`MISSING REQUIRED SECTIONS: ${result.sectionsMissing.join(", ")}`)
  }

  if (result.validationErrors.length > 0) {
    parts.push(`ERRORS: ${result.validationErrors.join("; ")}`)
  }

  if (result.actionItemCount < 2) {
    parts.push("NEED MORE ACTION ITEMS (at least 2)")
  }

  if (result.topicCount < 3) {
    parts.push("NEED MORE TOPIC CLUSTERS (at least 3)")
  }

  return parts.join("\n")
}

/** Enhanced dream runner that includes validation and retry */
export interface ValidatedDreamOptions {
  readonly state: DreamState
  readonly memoryCount: number
  readonly memories: string
  readonly config?: DreamConfig
  readonly synthesizer: (input: { prompt: string }) => Effect.Effect<string>
  readonly writeMemory: (value: string) => Effect.Effect<void>
}

export function validatedMaybeDream(options: ValidatedDreamOptions): Effect.Effect<DreamState> {
  const config = options.config ?? DEFAULT_DREAM_CONFIG
  return Effect.gen(function* () {
    const candidate: DreamState = {
      ...options.state,
      memoryCount: options.memoryCount,
      sessionsSinceDream: options.state.sessionsSinceDream + 1,
      retryCount: 0,
    }
    if (!shouldDream(candidate, config)) return candidate

    let attempt = 0
    let lastResult: DreamResult | null = null

    while (attempt <= config.maxRetries) {
      const prompt = formatDreamPrompt(options.memories, config)
      const raw = yield* options.synthesizer({ prompt })
      const result = analyzeDreamResult(raw)
      lastResult = result

      if (result.qualityScore >= config.minQualityScore && result.sectionsMissing.length === 0) {
        yield* options.writeMemory(result.summary)
        yield* Effect.logInfo("dream synthesis complete", {
          topicCount: result.topicCount,
          actionItemCount: result.actionItemCount,
          qualityScore: result.qualityScore,
          attempts: attempt + 1,
        })
        return {
          lastDreamAt: Date.now(),
          sessionsSinceDream: 0,
          memoryCount: options.memoryCount,
          lastDreamQuality: result.qualityScore,
          retryCount: attempt,
        }
      }

      attempt++
      candidate.retryCount = attempt

      if (attempt <= config.maxRetries) {
        // 记录验证失败，准备重试
        yield* Effect.logWarning("dream validation failed, retrying", {
          attempt,
          qualityScore: result.qualityScore,
          missingSections: result.sectionsMissing,
          errors: result.validationErrors,
        })
      }
    }

    // 所有重试都失败，记录并返回最后状态（不更新 lastDreamAt，下次会继续尝试）
    yield* Effect.logError("dream synthesis failed after max retries", {
      attempts: config.maxRetries + 1,
      finalQuality: lastResult?.qualityScore,
      missingSections: lastResult?.sectionsMissing,
    })

    return candidate
  })
}