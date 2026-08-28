// QueryEngine —— gyc cli 会话生命周期：
// 一个会话一个实例；messages / readFileState / totalUsage 跨 turn 持久

import * as readline from "node:readline"
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
  private readonly messages: Message[] = []
  private readonly totalUsage: Usage = { input_tokens: 0, output_tokens: 0 }
  private readonly rl: readline.Interface

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
    this.rl = readline.createInterface({ input: process.stdin, output: process.stdout })
  }

  private readonly mode: PermissionMode

  private ask(prompt: string): Promise<boolean> {
    return new Promise(resolve => {
      this.rl.question(`${prompt} `, answer => {
        resolve(/^y(es)?$/i.test(answer.trim()))
      })
    })
  }

  /** 提交一条用户消息并跑完整个 agentic 循环 */
  async submitMessage(text: string): Promise<string> {
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
      onText: text => {
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

  close(): void {
    this.rl.close()
  }
}
