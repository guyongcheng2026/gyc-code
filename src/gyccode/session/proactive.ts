export interface ProactiveConfig {
  /** Enable autonomous mode */
  enabled: boolean
  /** Max autonomous rounds before requiring user input */
  maxRounds: number
  /** Max consecutive rounds with no meaningful progress */
  stuckThreshold: number
}

export const DEFAULT_PROACTIVE_CONFIG: ProactiveConfig = {
  enabled: false,
  maxRounds: 10,
  stuckThreshold: 3,
}

export interface RoundMetrics {
  filesChanged: number
  linesChanged: number
  toolsCalled: number
  errorsEncountered: number
}

export function isStuck(
  recentRounds: readonly RoundMetrics[],
  threshold: number = DEFAULT_PROACTIVE_CONFIG.stuckThreshold,
): boolean {
  if (recentRounds.length < threshold) return false

  const relevant = recentRounds.slice(-threshold)
  return relevant.every(
    (round) => round.filesChanged === 0 && round.linesChanged === 0 && round.errorsEncountered === 0,
  )
}

export function shouldContinue(
  currentRound: number,
  config: ProactiveConfig = DEFAULT_PROACTIVE_CONFIG,
): boolean {
  if (!config.enabled) return false
  return currentRound < config.maxRounds
}

export function formatStuckPrompt(lastActions: string): string {
  return `I notice the last ${DEFAULT_PROACTIVE_CONFIG.stuckThreshold} rounds showed no meaningful progress. Last actions: ${lastActions}

I should either:
1. Try a different approach
2. Ask the user for clarification
3. Break the task into smaller steps`
}
