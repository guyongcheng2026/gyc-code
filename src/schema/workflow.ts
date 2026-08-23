/**
 * 工作流编排引擎共享 Schema（Workflow）
 *
 * 定位：Compose / Spec / Solo 融合编排的核心数据结构。
 * - WorkflowDef：用户可自定义的工作流定义（YAML/JSON 均可映射，CLI/Web 侧负责解析文本格式）
 * - WorkflowRun：一次工作流运行的持久化状态（步骤状态机）
 * - WorkflowStepStatus / WorkflowRunStatus：步骤与运行状态枚举
 *
 * 设计约束：
 * - 步骤之间默认串行（DAG 依赖留待后续扩展，先保证单链可验证）
 * - onFailure 支持 "stop" | "continue" | 指定步骤 id（跳转）
 * - retry 为步骤失败后的最大重试次数
 */
import { Schema } from "effect"

/** 步骤失败后的处理策略：终止 / 继续下一步 / 跳转到指定步骤 */
export const StepFailurePolicy = Schema.Union([
  Schema.Literal("stop"),
  Schema.Literal("continue"),
  Schema.String,
])
export type StepFailurePolicy = Schema.Schema.Type<typeof StepFailurePolicy>

/** 工作流步骤定义 */
export class WorkflowStepDef extends Schema.Class<WorkflowStepDef>("WorkflowStepDef")({
  id: Schema.String,
  name: Schema.String,
  description: Schema.String.pipe(Schema.optional),
  /** 步骤任务指令（发给 agent 的 prompt 主体） */
  prompt: Schema.String,
  /** 可选：指定该步骤使用的 agent（如 build / plan / compose / 自定义 subagent） */
  agent: Schema.String.pipe(Schema.optional),
  /** 可选：指定该步骤使用的模型标识（providerID/modelID 或 model 别名） */
  model: Schema.String.pipe(Schema.optional),
  /** 可选：验证指令（追加到步骤 prompt，要求 agent 执行验证后给出结论） */
  verify: Schema.String.pipe(Schema.optional),
  /** 失败重试次数（默认 0） */
  retry: Schema.Number.pipe(Schema.optional),
  /** 失败处理策略（默认 "stop"） */
  onFailure: StepFailurePolicy.pipe(Schema.optional),
}) {}

/** 工作流定义 */
export class WorkflowDef extends Schema.Class<WorkflowDef>("WorkflowDef")({
  name: Schema.String,
  description: Schema.String.pipe(Schema.optional),
  version: Schema.String.pipe(Schema.optional),
  steps: Schema.Array(WorkflowStepDef),
}) {}

/** 运行状态 */
export const WorkflowRunStatus = Schema.Literals(["pending", "running", "done", "failed", "aborted"])
export type WorkflowRunStatus = Schema.Schema.Type<typeof WorkflowRunStatus>

/** 步骤状态 */
export const WorkflowStepStatus = Schema.Literals(["pending", "running", "done", "failed", "skipped", "aborted"])
export type WorkflowStepStatus = Schema.Schema.Type<typeof WorkflowStepStatus>

/** 单步运行状态 */
export class WorkflowRunStep extends Schema.Class<WorkflowRunStep>("WorkflowRunStep")({
  stepId: Schema.String,
  status: WorkflowStepStatus,
  /** 已重试次数 */
  retries: Schema.Number.pipe(Schema.optional),
  /** 步骤输出摘要（步骤结束时的最终 assistant 文本） */
  summary: Schema.String.pipe(Schema.optional),
  /** 失败原因（status=failed 时存在） */
  error: Schema.String.pipe(Schema.optional),
  timeStarted: Schema.Number.pipe(Schema.optional),
  timeEnded: Schema.Number.pipe(Schema.optional),
}) {}

/** 一次工作流运行 */
export class WorkflowRun extends Schema.Class<WorkflowRun>("WorkflowRun")({
  id: Schema.String,
  /** 运行的工作流名称 */
  workflow: Schema.String,
  /** 关联会话 ID */
  sessionID: Schema.String,
  /** 运行所在目录（绝对路径） */
  directory: Schema.String,
  status: WorkflowRunStatus,
  /** 当前步骤索引（-1 表示尚未开始） */
  currentStepIndex: Schema.Number,
  steps: Schema.Array(WorkflowRunStep),
  /** 运行级错误信息 */
  error: Schema.String.pipe(Schema.optional),
  timeCreated: Schema.Number,
  timeUpdated: Schema.Number,
}) {}
export * as Workflow from "./workflow"