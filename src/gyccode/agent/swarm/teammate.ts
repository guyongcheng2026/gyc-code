import { TeammateConfig, TeammateResult } from "./types"

export function createTeammatePrompt(config: TeammateConfig, task: string): string {
  const rolePrompts: Record<string, string> = {
    explorer: "You are a code explorer. Your job is to understand the codebase and find relevant files, patterns, and dependencies.",
    implementer: "You are an implementer. Your job is to write clean, working code that solves the assigned task.",
    reviewer: "You are a code reviewer. Your job is to find bugs, suggest improvements, and verify correctness.",
    debugger: "You are a debugger. Your job is to find and fix issues in the code.",
  }

  return `${rolePrompts[config.role] ?? rolePrompts.implementer}

Task: ${task}

${config.systemPrompt ?? ""}

Report your findings concisely. Focus on actionable results.`
}

export function summarizeTeammateResults(results: readonly TeammateResult[]): string {
  const successCount = results.filter(r => r.success).length
  const parts = results.map(r =>
    `[${r.role}] ${r.success ? "OK" : "FAIL"}: ${r.summary} (${r.stepsCompleted} steps)`
  )
  return `${successCount}/${results.length} teammates succeeded.\n${parts.join("\n")}`
}