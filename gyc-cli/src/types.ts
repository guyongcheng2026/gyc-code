// gyc cli 核心类型 —— 对话消息、权限、工具结果与用量

export type ContentBlock =
  | { type: "text"; text: string }
  | { type: "tool_use"; id: string; name: string; input: Record<string, unknown> }
  | {
      type: "tool_result"
      tool_use_id: string
      content: string
      is_error?: boolean
    }

export type Role = "user" | "assistant"

export type Message = {
  role: Role
  content: string | ContentBlock[]
  uuid?: string
}

export type ToolUseBlock = Extract<ContentBlock, { type: "tool_use" }>

// ---------------------------------------------------------------------------
// 权限（参照 types/permissions.ts 的 PermissionResult）
// ---------------------------------------------------------------------------

export type PermissionResult =
  | { behavior: "allow"; updatedInput: Record<string, unknown> }
  | { behavior: "deny"; message: string }
  | { behavior: "ask"; message: string }

export type PermissionMode = "default" | "acceptEdits" | "bypassPermissions"

// ---------------------------------------------------------------------------
// 工具结果
// ---------------------------------------------------------------------------

export type ValidationResult =
  | { result: true }
  | { result: false; message: string }

export type ToolOutput = {
  /** 模型可见的文本结果 */
  content: string
  /** 是否为错误结果（is_error tool_result） */
  isError?: boolean
}

// ---------------------------------------------------------------------------
// LLM 用量
// ---------------------------------------------------------------------------

export type Usage = {
  input_tokens: number
  output_tokens: number
}

export type LlmResponse = {
  role: "assistant"
  content: ContentBlock[]
  stop_reason: string | null
  usage: Usage
}

export type CanUseToolFn = (
  toolName: string,
  input: Record<string, unknown>,
) => Promise<PermissionResult>
