// gyc cli 权限系统：
// - 只读工具直接放行（checkPermissions 默认 allow + isReadOnly 快速通道）
// - 写/执行工具经 askUser 命令行确认（default 模式）
// - bypassPermissions 模式全放行；acceptEdits 仅放行文件编辑

import type { CanUseToolFn, PermissionMode } from "./types"
import type { Tool, ToolContext } from "./tool"

export function createCanUseTool(params: {
  tools: Tool[]
  mode: PermissionMode
  context: ToolContext
}): CanUseToolFn {
  return async (toolName, input) => {
    const tool = params.tools.find(t => t.name === toolName)
    if (!tool) {
      return { behavior: "deny", message: `未知工具: ${toolName}` }
    }
    if (params.mode === "bypassPermissions") {
      return { behavior: "allow", updatedInput: input }
    }
    // 工具级判断（如 Bash 的命令前缀规则，精简版直接交给工具自身）
    const result = await tool.checkPermissions(input, params.context)
    if (result.behavior === "deny") return result
    const effectiveInput = result.behavior === "allow" ? result.updatedInput : input
    // 只读工具免确认
    if (tool.isReadOnly(effectiveInput)) {
      return { behavior: "allow", updatedInput: effectiveInput }
    }
    // acceptEdits 模式放行文件编辑类
    if (params.mode === "acceptEdits" && ["Write", "Edit", "NotebookEdit"].includes(toolName)) {
      return { behavior: "allow", updatedInput: effectiveInput }
    }
    // default 模式：命令行确认
    const summary = summarizeInput(toolName, effectiveInput)
    const approved = await params.context.askUser(`允许执行 ${toolName}(${summary})？[y/N]`)
    if (!approved) {
      return { behavior: "deny", message: `用户拒绝了 ${toolName} 工具调用` }
    }
    return { behavior: "allow", updatedInput: effectiveInput }
  }
}

function summarizeInput(toolName: string, input: Record<string, unknown>): string {
  const candidate =
    (input.file_path as string | undefined) ??
    (input.command as string | undefined) ??
    (input.pattern as string | undefined) ??
    ""
  const text = String(candidate).slice(0, 80)
  return text
}
