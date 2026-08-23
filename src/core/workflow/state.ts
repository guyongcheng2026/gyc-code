/**
 * 工作流引擎纯逻辑层（Workflow State）
 *
 * 定位：从引擎 Effect 层剥离的可测试纯函数。
 * - parseDefinition：JSON/JSONC 定义解析与 Schema 校验
 * - transitionAfterStep：单步执行结果 → 状态机下一步决策
 *   （成功推进 / 失败重试 / onFailure 跳转 / 终止失败）
 */
import { Effect, Schema } from "effect"
import { parse as parseJsonc, printParseErrorCode } from "jsonc-parser"
import {
  WorkflowDef as WorkflowDefSchema,
  WorkflowRunStep as WorkflowRunStepSchema,
  type WorkflowDef,
  type WorkflowRunStep,
  type WorkflowStepDef,
} from "@gyccode/schema/workflow"

export class DefinitionError extends Schema.TaggedErrorClass<DefinitionError>()("Workflow.DefinitionError", {
  message: Schema.String,
}) {}

/** 解析工作流定义（支持 JSON / JSONC，缺省 name 用文件名补齐） */
export const parseDefinition = (name: string, text: string): Effect.Effect<WorkflowDef, DefinitionError> =>
  Effect.gen(function* () {
    const errors: unknown[] = []
    const value = parseJsonc(text, errors, { allowTrailingComma: true })
    if (errors.length > 0) {
      return yield* Effect.fail(
        new DefinitionError({
          message: `工作流 ${name} 解析失败: ${errors.map((e) => printParseErrorCode(e.error)).join(", ")}`,
        }),
      )
    }
    if (value === undefined || typeof value !== "object" || value === null) {
      return yield* Effect.fail(new DefinitionError({ message: `工作流 ${name} 为空` }))
    }
    const raw = value as { name?: string; description?: string; version?: string; steps?: unknown }
    const def = yield* Schema.decodeUnknownEffect(WorkflowDefSchema)({
      ...raw,
      name: raw.name ?? name,
      steps: raw.steps ?? [],
    }).pipe(Effect.mapError((error) => new DefinitionError({ message: `工作流 ${name} 结构无效: ${error.message}` })))
    return def
  })

/** 单步执行结果 */
export type StepOutcome = { ok: true; summary: string } | { ok: false; error?: string; summary: string }

/** 状态机决策结果 */
export type TransitionResult =
  | { kind: "next"; steps: WorkflowRunStep[]; currentStepIndex: number }
  | { kind: "retry"; steps: WorkflowRunStep[] }
  | { kind: "jump"; steps: WorkflowRunStep[]; currentStepIndex: number }
  | { kind: "fail"; steps: WorkflowRunStep[]; error: string }

/**
 * 根据单步执行结果计算状态机下一步。
 * - 成功：步骤标记 done，推进到下一索引
 * - 失败且未达 retry 上限：步骤回到 pending，retries + 1，原地重试
 * - 失败且达上限：步骤标记 failed；onFailure 为 continue 则推进、
 *   为步骤 id 则跳转（中间步骤标记 skipped），否则终止失败
 */
export const transitionAfterStep = (
  input: { steps: WorkflowRunStep[]; index: number; stepDef: WorkflowStepDef; def: WorkflowDef; outcome: StepOutcome },
  now = Date.now(),
): TransitionResult => {
  const { steps, index, stepDef, def, outcome } = input
  if (outcome.ok) {
    const nextSteps = steps.map((s, i) =>
      i === index ? new WorkflowRunStepSchema({ ...s, status: "done", summary: outcome.summary, timeEnded: now }) : s,
    )
    return { kind: "next", steps: nextSteps, currentStepIndex: index + 1 }
  }

  const stepState = steps[index]!
  const retries = stepState.retries ?? 0
  const maxRetry = stepDef.retry ?? 0
  if (retries < maxRetry) {
    const retrySteps = steps.map((s, i) =>
      i === index ? new WorkflowRunStepSchema({ ...s, status: "pending", retries: retries + 1 }) : s,
    )
    return { kind: "retry", steps: retrySteps }
  }

  const failedSteps = steps.map((s, i) =>
    i === index
      ? new WorkflowRunStepSchema({ ...s, status: "failed", retries, error: outcome.error ?? "", timeEnded: now })
      : s,
  )
  const policy = stepDef.onFailure ?? "stop"
  if (policy === "continue") {
    return { kind: "next", steps: failedSteps, currentStepIndex: index + 1 }
  }
  if (policy !== "stop") {
    const targetIndex = def.steps.findIndex((s) => s.id === policy)
    if (targetIndex >= 0) {
      const jumped = failedSteps.map((s, i) =>
        i > index && i < targetIndex ? new WorkflowRunStepSchema({ ...s, status: "skipped", timeEnded: now }) : s,
      )
      return { kind: "jump", steps: jumped, currentStepIndex: targetIndex }
    }
  }
  return { kind: "fail", steps: failedSteps, error: outcome.error ?? "步骤失败" }
}