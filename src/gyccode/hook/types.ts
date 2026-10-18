import { Schema } from "effect"

export const HOOK_EVENTS = [
  "PreToolUse",
  "PostToolUse",
  "PreCompact",
  "PostCompact",
  "SessionStart",
  "SessionEnd",
  "PreMessage",
  "PostMessage",
  "Notification",
] as const
export const HookEvent = Schema.Literals(HOOK_EVENTS)
export type HookEvent = typeof HookEvent.Type

/**
 * 运行时 hook 配置。字段与 `@gyccode/core/v1/config/hook` 的 `ConfigHookV1.Hook`
 * 一一对应；这里用普通 interface 承载，避免运行时 Schema 类与配置解析层耦合。
 */
export interface HookConfig {
  event: string
  command: string
  matcher?: string
  timeout?: number
}

/**
 * 传给 hook 子进程 stdin 的 JSON 输入。事件不同，填充的字段也不同：
 * - PreToolUse / PostToolUse 额外带 `tool_name`，PreToolUse 带 `tool_input`，
 *   PostToolUse 带 `tool_response`。
 */
export interface HookInput {
  hook_event_name: string
  session_id: string
  cwd: string
  tool_name?: string
  tool_input?: unknown
  tool_response?: unknown
}

/** PreToolUse 的权限决策。deny 会阻止工具执行，ask 转入权限询问。 */
export type HookDecision = "allow" | "deny" | "ask"

/**
 * hook 子进程 stdout 的 JSON 输出。全部字段可选：hook 不输出 JSON 或只
 * 输出非 JSON 文本时，视为「无结构化决策」，不阻断、不注入。
 */
export interface HookOutput {
  decision?: HookDecision
  /** 追加给用户可见结果的消息 */
  message?: string
  /** 追加给模型（system）的消息 */
  systemMessage?: string
  /** PreToolUse 改写工具入参 */
  updatedInput?: Record<string, unknown>
  /** 即使未 deny 也阻止流程继续 */
  preventContinuation?: boolean
  /** 停止原因说明 */
  stopReason?: string
  /** PostToolUse 追加上下文 */
  additionalContext?: string
}

/** 单个 hook 执行后的完整结果（含解析后的结构化输出与原始流）。 */
export interface HookOutcome {
  hook: HookConfig
  exitCode: number | null
  stdout: string
  stderr: string
  duration: number
  output: HookOutput | undefined
  /** spawn / 超时 / 解析等错误。单个 hook 失败不应中断主流程，仅记录。 */
  error: string | undefined
}

/** 兼容旧引用：hook 执行结果的最小字段集（dialog-hooks 展示用）。 */
export interface HookResult {
  event: HookEvent
  stdout: string
  stderr: string
  exitCode: number
  duration: number
}
