// gyc cli agentic 主循环：
// 1. 组装 system + messages 调 LLM
// 2. 解析响应中的 tool_use 块
// 3. partitionToolCalls：连续并发安全工具并发执行（上限 10），其余串行
// 4. schema/validateInput/权限失败均以 is_error tool_result 回喂模型
// 5. 有 tool_use 则继续循环，直到纯文本回复（stop_reason=end_turn）

import { randomUUID } from "node:crypto"
import {
  accumulateUsage,
  callLlm,
  emptyUsage,
  type ApiToolSchema,
  type LlmConfig,
} from "./llm"
import { createCanUseTool } from "./permissions"
import { validateAgainstSchema, type Tool, type ToolContext } from "./tool"
import type { CanUseToolFn, ContentBlock, Message, PermissionMode, ToolUseBlock, Usage } from "./types"

const MAX_TOOL_CONCURRENCY = 10
const MAX_TURNS = 40

export type QueryResult = {
  finalText: string
  usage: Usage
  turns: number
}

export async function* query(params: {
  config: LlmConfig
  system: string
  userContext: string
  messages: Message[]
  tools: Tool[]
  toolContext: ToolContext
  mode: PermissionMode
  onText?: (delta: string) => void
  onToolStart?: (toolName: string, input: Record<string, unknown>) => void
  onToolResult?: (toolName: string, output: string, isError: boolean) => void
}): AsyncGenerator<{ assistantText?: string; done?: QueryResult }> {
  const canUseTool = createCanUseTool({
    tools: params.tools,
    mode: params.mode,
    context: params.toolContext,
  })
  const apiTools: ApiToolSchema[] = params.tools.map(tool => ({
    name: tool.name,
    description: tool.description,
    input_schema: {
      type: "object",
      properties: tool.inputSchema.properties,
      required: tool.inputSchema.required,
    },
  }))
  const totalUsage = emptyUsage()
  let turns = 0

  while (turns < MAX_TURNS) {
    turns++
    const response = await callLlm({
      config: params.config,
      system: params.system + (params.userContext ? `\n\n${params.userContext}` : ""),
      messages: params.messages,
      tools: apiTools,
    })
    accumulateUsage(totalUsage, response.usage)

    const assistantMessage: Message = { role: "assistant", content: response.content, uuid: randomUUID() }
    params.messages.push(assistantMessage)

    // 输出文本块
    const textBlocks = response.content.filter((b): b is Extract<ContentBlock, { type: "text" }> => b.type === "text")
    const assistantText = textBlocks.map(b => b.text).join("")
    if (assistantText && params.onText) params.onText(assistantText)

    const toolUseBlocks = response.content.filter((b): b is ToolUseBlock => b.type === "tool_use")
    if (toolUseBlocks.length === 0) {
      yield { assistantText, done: { finalText: assistantText, usage: totalUsage, turns } }
      return
    }

    // 工具调度：并发批 / 串行批
    const toolResults: ContentBlock[] = []
    for (const batch of partitionToolCalls(toolUseBlocks, params.tools)) {
      if (batch.isConcurrencySafe) {
        const settled = await Promise.all(
          batch.blocks.map(block => runSingleTool(block, params, canUseTool)),
        )
        toolResults.push(...settled)
      } else {
        for (const block of batch.blocks) {
          toolResults.push(await runSingleTool(block, params, canUseTool))
        }
      }
    }
    params.messages.push({ role: "user", content: toolResults, uuid: randomUUID() })
    yield { assistantText }
  }
  yield {
    done: {
      finalText: "（达到最大轮次限制，任务未完成）",
      usage: totalUsage,
      turns,
    },
  }
}

type Batch = { isConcurrencySafe: boolean; blocks: ToolUseBlock[] }

/** 参照 toolOrchestration.ts 的 partitionToolCalls：连续并发安全工具归入同批 */
function partitionToolCalls(blocks: ToolUseBlock[], tools: Tool[]): Batch[] {
  const batches: Batch[] = []
  for (const block of blocks) {
    const tool = tools.find(t => t.name === block.name)
    let safe = false
    if (tool) {
      const parsed = validateAgainstSchema(block.input, tool.inputSchema)
      if (parsed.ok) {
        try {
          safe = tool.isConcurrencySafe(parsed.value)
        } catch {
          safe = false
        }
      }
    }
    const lastBatch = batches[batches.length - 1]
    if (safe && lastBatch?.isConcurrencySafe) {
      lastBatch.blocks.push(block)
    } else {
      batches.push({ isConcurrencySafe: safe, blocks: [block] })
    }
  }
  return batches
}

/** 单工具执行：schema 校验 → 权限 → validateInput → call，任一失败均回喂 tool_use_error */
async function runSingleTool(
  block: ToolUseBlock,
  params: {
    tools: Tool[]
    toolContext: ToolContext
    onToolStart?: (toolName: string, input: Record<string, unknown>) => void
    onToolResult?: (toolName: string, output: string, isError: boolean) => void
  },
  canUseTool: CanUseToolFn,
): Promise<ContentBlock> {
  const fail = (message: string): ContentBlock => ({
    type: "tool_result",
    tool_use_id: block.id,
    content: `<tool_use_error>${message}</tool_use_error>`,
    is_error: true,
  })
  const tool = params.tools.find(t => t.name === block.name)
  if (!tool) return fail(`未知工具: ${block.name}`)

  const parsed = validateAgainstSchema(block.input, tool.inputSchema)
  if (!parsed.ok) return fail(parsed.error)

  params.onToolStart?.(tool.name, parsed.value)
  const permission = await canUseTool(tool.name, parsed.value)
  if (permission.behavior !== "allow") return fail(permission.message)
  const input = permission.updatedInput

  const validation = tool.validateInput
    ? await tool.validateInput(input, params.toolContext)
    : { result: true as const }
  if (validation.result === false) return fail(validation.message)

  try {
    const output = await tool.call(input, params.toolContext)
    params.onToolResult?.(tool.name, output.content, output.isError === true)
    return {
      type: "tool_result",
      tool_use_id: block.id,
      content: output.content,
      is_error: output.isError,
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    params.onToolResult?.(tool.name, message, true)
    return fail(message)
  }
}
