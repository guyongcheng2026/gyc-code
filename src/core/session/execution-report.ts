/**
 * R-5：会话执行报告。会话跑完后必须能回答三个问题——
 * **跑了多少步、为什么停、耗了多少成本与 token**。
 *
 * 本模块是**零表改动**方案，并且刻意做成不依赖任何运行时的纯模块（无外部引用）：
 * 终止原因、成本、token、步数这四类事实都来自**既有**存储，判定只做纯函数推导。
 *
 * 取证与复用点：
 * - 终止原因复用 assistant 消息已持久化的字段。`message` 表把整条消息以 JSON 存进
 *   `data`（见 core/database/schema.gen.ts:135-142），其中 `error.name` 定义在
 *   schema/v1/session.ts:70（AssistantError），`finish` 定义在 schema/v1/session.ts:494。
 *   所以「最后一条 assistant 消息」就能还原根因，不需要新增终止原因列。
 * - 成本与 token 复用 session 表累计列 cost / tokens_*（core/session/sql.ts:42-47），
 *   单次明细在 append-only 的 cost_ledger（core/session/cost-ledger-table.ts:7-28）。
 * - 步数复用每步发布一次的 SessionEvent.Step.Ended（core/session/runner/llm.ts:350-361）。
 *
 * 判定优先级（从强到弱，实时信号优先于事后从库里读出的痕迹）：
 * 1. interrupted        —— core/session/runner/llm.ts:320 与 llm.ts:328-335 的
 *                          Cause.hasInterrupts，以及 llm.ts:202 / llm.ts:325 的 Effect.interrupt
 * 2. permissionDenied   —— llm.ts:322-326 的 isUserDeclined(settled.cause)，
 *                          判据在 llm.ts:163-168：PermissionV2.DeclinedError 或 QuestionV2.RejectedError
 * 3. providerError      —— llm.ts:316-319、llm.ts:505-512 的 publisher.hasProviderError()
 * 4. errorName          —— 持久化痕迹。MessageAbortedError 归用户中断，
 *                          其余 provider 侧错误（schema/v1/session.ts:36-63 的具名错误）归 provider 错误
 * 5. maxSteps           —— llm.ts:226 的 isLastStep（currentStep >= agent.info.steps）
 *                          触发 llm.ts:237 的 toolChoice="none" 与 llm.ts:270 的「工具已被停用」
 * 6. completed          —— llm.ts:512 的 `!publisher.hasProviderError() && needsContinuation`
 *                          且 llm.ts:568 之后已无待处理 steer / llm.ts:570 之后已无待处理 queue
 * 7. unknown            —— 以上都判不出来的兜底，**不臆造**原因
 *
 * 为什么没有「超出预算被中止」这一项：预算分支从不 halt run，只发布告警事件。
 * 依据 src/core/config.ts:120——超预算「publishes a Budget.Warning event; it does NOT halt
 * the run」；src/core/config/quota-alert.ts:4 亦佐证预算分支只做告警判定。
 * 因此即便 budgetExceeded 为真，也**不能**把停止归因于预算，只能落到 unknown。
 */

/** 终止原因枚举：只包含能从既有代码路径可靠推断出来的取值。 */
export const TerminalReason = {
  /** 模型不再请求工具调用，也没有待处理输入，本轮自然收敛。 */
  Completed: "completed",
  /** 抵达 agent 配置的最大步数，最后一步工具调用已被禁用。 */
  MaxSteps: "max_steps",
  /** 权限请求被拒绝，循环中止（不会变成模型可见的工具结果）。 */
  PermissionDenied: "permission_denied",
  /** 模型提供方返回错误。 */
  ProviderError: "provider_error",
  /** 执行被用户中断。 */
  UserInterrupted: "user_interrupted",
  /** 无法从既有数据判定（含预算超限但预算并不中止的场景）。 */
  Unknown: "unknown",
} as const

export type TerminalReason = (typeof TerminalReason)[keyof typeof TerminalReason]

/** 全部终止原因，顺序即判定优先级中的枚举顺序，供 CLI 展示与测试遍历。 */
export const TERMINAL_REASONS: readonly TerminalReason[] = [
  TerminalReason.Completed,
  TerminalReason.MaxSteps,
  TerminalReason.PermissionDenied,
  TerminalReason.ProviderError,
  TerminalReason.UserInterrupted,
  TerminalReason.Unknown,
]

/** 一次执行的 token 消耗，口径与 session 表的 tokens_* 列一致。 */
export type TokenUsage = {
  readonly input: number
  readonly output: number
  readonly reasoning: number
  readonly cache: { readonly read: number; readonly write: number }
}

/** 一次执行的花费与 token，来自 session 表累计列或 cost_ledger 聚合。 */
export type ExecutionUsage = {
  /** 美元。 */
  readonly cost: number
  readonly tokens: TokenUsage
}

/**
 * 终止状态：只收既有代码路径已经观测到的事实，不收推测。
 * 实时信号（interrupted / permissionDenied / providerError / needsContinuation / pendingInput）
 * 来自 runner；errorName 来自最后一条 assistant 消息持久化后的 error.name。
 */
export type TerminalState = {
  /** 本次已执行的步数。 */
  readonly steps: number
  /** agent 配置的最大步数；缺省表示未设上限（llm.ts:226 的 agent.info.steps 为 undefined）。 */
  readonly maxSteps?: number
  /** runner 是否仍需要继续下一轮（llm.ts:512）。 */
  readonly needsContinuation: boolean
  /** 是否还有待处理的 steer / queue 输入（llm.ts:568、llm.ts:570）。 */
  readonly pendingInput?: boolean
  /** provider 是否报错（llm.ts:316-319、llm.ts:505-512）。 */
  readonly providerError?: boolean
  /** 权限或提问请求被拒绝（llm.ts:322-326 + llm.ts:163-168）。 */
  readonly permissionDenied?: boolean
  /** 是否被用户中断（llm.ts:320、llm.ts:328-335）。 */
  readonly interrupted?: boolean
  /** 最后一条 assistant 消息持久化的 error.name（schema/v1/session.ts:70）。 */
  readonly errorName?: string
  /**
   * 预算是否已超限。**仅作记录，不参与判定**：预算分支从不中止运行
   * （src/core/config.ts:120、src/core/config/quota-alert.ts:4），
   * 所以超预算本身不构成终止原因。
   */
  readonly budgetExceeded?: boolean
}

/** 一次会话执行的完整报告。 */
export type ExecutionReport = {
  readonly steps: number
  readonly terminalReason: TerminalReason
  /** 面向用户的简体中文说明，点名根因。 */
  readonly summary: string
  readonly usage: ExecutionUsage
}

/** 会被归到「用户中断」的持久化错误名（schema/v1/session.ts:43）。 */
const ABORTED_ERROR_NAMES: ReadonlySet<string> = new Set(["MessageAbortedError"])

/** 会被归到「provider 错误」的持久化错误名（schema/v1/session.ts:36-63 的具名错误）。 */
const PROVIDER_ERROR_NAMES: ReadonlySet<string> = new Set([
  "MessageOutputLengthError",
  "ProviderAuthError",
  "StructuredOutputError",
  "APIError",
  "ContextOverflowError",
  "ContentFilterError",
])

/** 缺失或非法的数值一律按 0 计，避免报表里出现 NaN。 */
const finite = (value: number | undefined): number =>
  value !== undefined && Number.isFinite(value) ? value : 0

/**
 * 判定终止原因。纯函数：同样的输入永远得到同样的输出，无副作用、不读时钟、不碰 I/O。
 * 判定依据逐条写在文件头注释里，改动 runner 时请一并更新。
 */
export function classifyTerminalReason(state: TerminalState): TerminalReason {
  if (state.interrupted === true) return TerminalReason.UserInterrupted
  if (state.permissionDenied === true) return TerminalReason.PermissionDenied
  if (state.providerError === true) return TerminalReason.ProviderError
  const errorName = state.errorName
  if (errorName !== undefined && errorName !== "") {
    if (ABORTED_ERROR_NAMES.has(errorName)) return TerminalReason.UserInterrupted
    if (PROVIDER_ERROR_NAMES.has(errorName)) return TerminalReason.ProviderError
  }
  const maxSteps = state.maxSteps
  if (maxSteps !== undefined && maxSteps > 0 && state.steps >= maxSteps) return TerminalReason.MaxSteps
  if (state.needsContinuation === false && state.pendingInput !== true) return TerminalReason.Completed
  // 预算超限但预算不会中止运行，因此不能归因；其余判不出来的情况同样不臆造。
  return TerminalReason.Unknown
}

/** 面向用户的简体中文说明：点名根因，不用「已结束」这类无信息量的说法。 */
export function describeTerminalReason(state: TerminalState): string {
  switch (classifyTerminalReason(state)) {
    case TerminalReason.Completed:
      return "正常完成：模型不再请求工具调用，也没有待处理的输入，本轮已自然结束。"
    case TerminalReason.MaxSteps:
      return `达到最大步数：已执行 ${finite(state.maxSteps)} 步，工具调用在最后一步已被禁用，执行到此结束。`
    case TerminalReason.PermissionDenied:
      return "被权限拒绝中止：权限或提问请求被拒绝，本轮不再继续执行，也不会把拒绝变成模型可见的工具结果。"
    case TerminalReason.ProviderError:
      return state.errorName !== undefined && state.errorName !== ""
        ? `被 provider 错误中止：模型提供方返回错误 ${state.errorName}。`
        : "被 provider 错误中止：模型提供方返回错误。"
    case TerminalReason.UserInterrupted:
      return "被用户中断：执行在中断信号到达时终止，未完成的工具调用已按中断结算。"
    case TerminalReason.Unknown:
      return state.budgetExceeded === true
        ? "无法从现有数据判定终止原因：预算已超限但预算只会告警、不会中止运行（src/core/config.ts:120），不能把停止归因于预算。"
        : "无法从现有数据判定终止原因：可能仍有待处理输入，或缺少最后一条 assistant 消息。"
  }
}

/** 汇总一次执行：步数 + 终止原因 + 花费 + token + 中文说明。纯函数。 */
export function buildExecutionReport(state: TerminalState & { readonly usage: ExecutionUsage }): ExecutionReport {
  return {
    steps: finite(state.steps),
    terminalReason: classifyTerminalReason(state),
    summary: describeTerminalReason(state),
    usage: normalizeUsage(state.usage),
  }
}

/** 把可能缺失的 usage 补齐为有限数值，保证报表里不出现 NaN / undefined。 */
function normalizeUsage(usage: ExecutionUsage): ExecutionUsage {
  return {
    cost: finite(usage.cost),
    tokens: {
      input: finite(usage.tokens.input),
      output: finite(usage.tokens.output),
      reasoning: finite(usage.tokens.reasoning),
      cache: { read: finite(usage.tokens.cache.read), write: finite(usage.tokens.cache.write) },
    },
  }
}

/** 渲染成一行人话，供日志与 CLI 直接打印。 */
export function formatExecutionReport(report: ExecutionReport): string {
  const t = report.usage.tokens
  return (
    `执行报告：${report.steps} 步 · ${report.summary} ` +
    `· 成本 $${report.usage.cost.toFixed(6)} · ` +
    `token 输入 ${t.input} / 输出 ${t.output} / 推理 ${t.reasoning} / 缓存读 ${t.cache.read} / 缓存写 ${t.cache.write}`
  )
}
