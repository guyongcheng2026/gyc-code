// Next-step prediction after each completed step.
// Lightweight heuristic — no LLM call, zero token cost.

export interface NextStepTodo {
  content: string
  status: string
}

export interface NextStepContext {
  todos: readonly NextStepTodo[]
  lastToolName?: string
  lastToolOutput: string
}

/** Predict the next task after a step completes. Returns undefined when no clear next step. */
export function predictNextStep(ctx: NextStepContext): string | undefined {
  const nextTodo = ctx.todos.find((t) => t.status === "pending" || t.status === "in_progress")
  if (nextTodo) return nextTodo.content

  if (/error|fail|exception|✗|traceback/i.test(ctx.lastToolOutput)) {
    return "诊断上一步失败原因并修复"
  }

  if (/success|complete|done|✓|succeed|finished/i.test(ctx.lastToolOutput)) {
    return "验证上一步结果是否满足要求"
  }

  return undefined
}