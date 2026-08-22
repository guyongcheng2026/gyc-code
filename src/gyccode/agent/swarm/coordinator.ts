import { SwarmPlan, TeammateConfig } from "./types"

export function planSwarm(goal: string, availableRoles: readonly TeammateConfig[]): SwarmPlan {
  const strategy = goal.includes("debug") || goal.includes("fix")
    ? "debug-first"
    : goal.includes("explore") || goal.includes("understand")
    ? "explore-then-report"
    : "implement-and-review"

  return new SwarmPlan({
    goal,
    teammates: availableRoles,
    strategy,
  })
}

export function assignTasks(plan: SwarmPlan): Map<string, string> {
  const tasks = new Map<string, string>()
  const roleTaskMap: Record<string, string> = {
    explorer: `Explore the codebase to understand: ${plan.goal}`,
    implementer: `Implement the changes needed to: ${plan.goal}`,
    reviewer: `Review the implementation for: ${plan.goal}`,
    debugger: `Debug issues related to: ${plan.goal}`,
  }

  for (const teammate of plan.teammates) {
    const task = roleTaskMap[teammate.role] ?? `Help with: ${plan.goal}`
    tasks.set(teammate.role, task)
  }

  return tasks
}