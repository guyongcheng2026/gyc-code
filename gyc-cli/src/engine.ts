// QueryEngine —— gyc cli 会话生命周期：
// 一个会话一个实例；messages / readFileState / totalUsage 跨 turn 持久
// 不持有常驻 readline（避免与主输入处理器竞争 stdin），权限确认用一次性 readline

import { getSystemPrompt, getUserContext } from "./context"
import { loadLlmConfig } from "./llm"
import { query } from "./query"
import { createBashTool, createGlobTool, createGrepTool } from "./tools/exec-tools"
import { createEditTool, createReadTool, createWriteTool } from "./tools/fs-tools"
import type { Tool, ToolContext } from "./tool"
import type { Message, PermissionMode, Usage } from "./types"

export class QueryEngine {
  private readonly config = loadLlmConfig()
  private readonly tools: Tool[]
  private readonly toolContext: ToolContext
  private messages: Message[] = []
  private readonly totalUsage: Usage = { input_tokens: 0, output_tokens: 0 }

  constructor(params: { cwd: string; mode: PermissionMode }) {
    this.tools = [
      createReadTool(),
      createWriteTool(),
      createEditTool(),
      createBashTool(),
      createGlobTool(),
      createGrepTool(),
    ]
    this.toolContext = {
      cwd: params.cwd,
      readFileState: new Map(),
      askUser: prompt => this.ask(prompt),
    }
    this.mode = params.mode
  }

  private readonly mode: PermissionMode

  /** 清空会话上下文（/clear 命令），开启新对话 */
  clear(): void {
    this.messages = []
  }

  /** 当前 LLM（provider/model），/model 命令展示 */
  modelInfo(): string {
    return `${this.config.provider}/${this.config.model}`
  }

  private async ask(prompt: string): Promise<boolean> {
    const { createInterface } = await import("node:readline/promises")
    const rl = createInterface({ input: process.stdin, output: process.stdout })
    try {
      const answer = await rl.question(`${prompt} `)
      return /^y(es)?$/i.test(answer.trim())
    } finally {
      rl.close()
    }
  }

  /** 提交一条用户消息并跑完整个 agentic 循环；emitText=false 时由调用方自行输出最终文本 */
  async submitMessage(text: string, options: { emitText?: boolean } = {}): Promise<string> {
    this.messages.push({ role: "user", content: text, uuid: crypto.randomUUID() })
    let finalText = ""
    for await (const update of query({
      config: this.config,
      system: getSystemPrompt(),
      userContext: getUserContext(this.toolContext.cwd),
      messages: this.messages,
      tools: this.tools,
      toolContext: this.toolContext,
      mode: this.mode,
      onText:
        options.emitText === false
          ? undefined
          : text => {
              process.stdout.write(text + "\n")
            },
      onToolStart: (toolName, input) => {
        const target =
          (input.file_path as string | undefined) ??
          (input.command as string | undefined) ??
          (input.pattern as string | undefined) ??
          ""
        process.stdout.write(`⏺ ${toolName}(${String(target).slice(0, 100)})\n`)
      },
      onToolResult: (toolName, output, isError) => {
        const mark = isError ? "✗" : "⎿"
        const preview = output.split("\n")[0]?.slice(0, 160) ?? ""
        process.stdout.write(`  ${mark} ${preview}\n`)
      },
    })) {
      if (update.done) {
        finalText = update.done.finalText
        this.totalUsage.input_tokens += update.done.usage.input_tokens
        this.totalUsage.output_tokens += update.done.usage.output_tokens
      }
    }
    return finalText
  }

  usageSummary(): string {
    return `tokens: 输入 ${this.totalUsage.input_tokens} / 输出 ${this.totalUsage.output_tokens}`
  }
}
