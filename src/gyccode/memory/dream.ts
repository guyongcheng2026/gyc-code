import { Effect } from "effect"
import { readHermesMemories, writeHermesMemoryFile } from "./hermes-bridge"

export interface DreamConfig {
  /** Hours between dreams */
  minHoursBetween: number
  /** Sessions between dreams */
  minSessionsBetween: number
  /** Minimum memories to trigger dream */
  minMemories: number
}

export const DEFAULT_DREAM_CONFIG: DreamConfig = {
  minHoursBetween: 24,
  minSessionsBetween: 5,
  minMemories: 10,
}

export interface DreamState {
  lastDreamAt: number  // timestamp ms
  sessionsSinceDream: number
  memoryCount: number
}

export function shouldDream(state: DreamState, config: DreamConfig = DEFAULT_DREAM_CONFIG): boolean {
  if (state.memoryCount < config.minMemories) return false

  const hoursSince = (Date.now() - state.lastDreamAt) / (1000 * 60 * 60)
  if (state.lastDreamAt === 0) return state.sessionsSinceDream >= config.minSessionsBetween

  return hoursSince >= config.minHoursBetween || state.sessionsSinceDream >= config.minSessionsBetween
}

export function formatDreamPrompt(memories: string): string {
  return `Synthesize these memories into a structured knowledge summary. Group by topic, identify key learnings, note action items. Output in markdown format with sections:

## Key Learnings
- Bullet points of important discoveries and insights

## Patterns & Preferences
- Recurring patterns in how the user works

## Action Items
- Things to follow up on

## Topic Clusters
- Group related memories by theme

Raw memories:
${memories}`
}

export function parseDreamResult(raw: string): string {
  // Return the full result as markdown - it already has structure
  return raw.trim()
}

export interface DreamResult {
  summary: string
  topicCount: number
  actionItemCount: number
}

export function analyzeDreamResult(content: string): DreamResult {
  const topicMatches = content.match(/^## /gm)
  const actionMatches = content.match(/^- \[ \]/gm) ?? content.match(/^- /gm)
  return {
    summary: content.slice(0, 200) + "...",
    topicCount: topicMatches?.length ?? 0,
    actionItemCount: actionMatches?.length ?? 0,
  }
}
