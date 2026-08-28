// gyc cli 工具定义骨架（buildTool 模式）：
// - fail-closed 默认值（isConcurrencySafe/isReadOnly 默认 false）
// - checkPermissions：工具级权限判断（默认 allow，交由全局权限系统）
// - validateInput：业务校验，失败以 tool_use_error 喂回模型
// - prompt()：注入系统提示的工具说明书
// - inputSchema：直接使用 JSON Schema（同时供 API 与本地校验）

import type { PermissionResult, ToolOutput } from "./types"

export type ToolSchema = {
  type: "object"
  properties: Record<string, { type: string; description: string; enum?: string[] }>
  required: string[]
}

export type ToolContext = {
  cwd: string
  /** 已读文件状态缓存：路径 -> { mtime, content }（Edit 用于检测外部修改） */
  readFileState: Map<string, { mtime: number; content: string }>
  /** 请求用户权限确认（行式 y/n），由入口注入 */
  askUser: (prompt: string) => Promise<boolean>
}

export type ToolDef = {
  name: string
  description: string
  inputSchema: ToolSchema
  /** 默认 false（fail-closed）：写操作必须显式声明 true 才能并发 */
  isConcurrencySafe?: (input: Record<string, unknown>) => boolean
  /** 默认 false（fail-closed）：只读操作显式声明 true 可跳过权限确认 */
  isReadOnly?: (input: Record<string, unknown>) => boolean
  checkPermissions?: (
    input: Record<string, unknown>,
    context: ToolContext,
  ) => Promise<PermissionResult>
  validateInput?: (
    input: Record<string, unknown>,
    context: ToolContext,
  ) => Promise<{ result: true } | { result: false; message: string }>
  call: (
    input: Record<string, unknown>,
    context: ToolContext,
  ) => Promise<ToolOutput>
}

const DEFAULTS = {
  isConcurrencySafe: () => false,
  isReadOnly: () => false,
  checkPermissions: async (input: Record<string, unknown>): Promise<PermissionResult> => ({
    behavior: "allow",
    updatedInput: input,
  }),
}

export type Tool = ToolDef & {
  isConcurrencySafe: (input: Record<string, unknown>) => boolean
  isReadOnly: (input: Record<string, unknown>) => boolean
  checkPermissions: (
    input: Record<string, unknown>,
    context: ToolContext,
  ) => Promise<PermissionResult>
}

/** buildTool：为缺省方法补齐 fail-closed 默认值（参照 Tool.ts 的 buildTool） */
export function buildTool(def: ToolDef): Tool {
  return { ...DEFAULTS, ...def }
}

// ---------------------------------------------------------------------------
// 轻量 schema 校验（零依赖替代 zod）：按 inputSchema 校验类型与必填项
// ---------------------------------------------------------------------------

export function validateAgainstSchema(
  input: Record<string, unknown>,
  schema: ToolSchema,
): { ok: true; value: Record<string, unknown> } | { ok: false; error: string } {
  for (const key of schema.required) {
    if (!(key in input)) {
      return { ok: false, error: `缺少必填参数: ${key}` }
    }
  }
  for (const [key, value] of Object.entries(input)) {
    const prop = schema.properties[key]
    if (!prop) continue
    const actual = Array.isArray(value) ? "array" : typeof value
    if (prop.type === "number" && actual !== "number") {
      return { ok: false, error: `参数 ${key} 应为数字，实际为 ${actual}` }
    }
    if ((prop.type === "string" || prop.type === "boolean") && actual !== prop.type) {
      return { ok: false, error: `参数 ${key} 应为 ${prop.type}，实际为 ${actual}` }
    }
    if (prop.enum && !prop.enum.includes(String(value))) {
      return { ok: false, error: `参数 ${key} 必须是 ${prop.enum.join(" | ")} 之一` }
    }
  }
  return { ok: true, value: input }
}
