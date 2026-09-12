// 流式渲染器 - 复用 TUI 的 streamLoop 核心渲染逻辑
// 支持：默认格式、JSON、Markdown、原始事件

import { streamLoop, type SubagentInfo } from "../cmd/run/stream-cli"
import { createGyccodeClient, type GyccodeClient, type SessionMessage } from "@gyccode/protocol/v2"
import { UI } from "../ui"
import { TokyoNight, Typography } from "../theme"

export type OutputFormat = "default" | "json" | "markdown" | "raw"

export interface RendererOptions {
  format: OutputFormat
  thinking?: boolean
  auto?: boolean
  sessionId: string
  client: GyccodeClient
  onSubagent?: (info: SubagentInfo) => void
}

export class StreamRenderer {
  private format: OutputFormat
  private thinking: boolean
  private auto: boolean
  private sessionId: string
  private client: GyccodeClient
  private onSubagent?: (info: SubagentInfo) => void

  constructor(options: RendererOptions) {
    this.format = options.format
    this.thinking = options.thinking ?? false
    this.auto = options.auto ?? false
    this.sessionId = options.sessionId
    this.client = options.client
    this.onSubagent = options.onSubagent
  }

  async render(
    messagePromise: Promise<unknown>,
    events: Awaited<ReturnType<GyccodeClient["event"]["subscribe"]>>
  ): Promise<string | undefined> {
    const completed = streamLoop({
      client: this.client,
      events,
      sessionID: this.sessionId,
      format: this.format === "json" ? "json" : "default",
      thinking: this.thinking,
      auto: this.auto,
      question: {
        reply: (requestID, answers) => this.client.v2.session.question.reply({ sessionID: this.sessionId, requestID, questionV2Reply: { answers } }),
        reject: (requestID) => this.client.v2.session.question.reject({ sessionID: this.sessionId, requestID }),
      },
      onSubagent: this.onSubagent,
    })

    await messagePromise
    return completed
  }
}

// JSON 格式化器
export class JsonFormatter {
  static formatEvent(event: unknown): string {
    const obj = event && typeof event === "object" ? event as Record<string, unknown> : {}
    return JSON.stringify({ ...obj, timestamp: Date.now() }) + "\n"
  }

  static formatError(error: unknown): string {
    return JSON.stringify({ type: "error", timestamp: Date.now(), error: String(error) }) + "\n"
  }

  static formatResult(result: unknown): string {
    return JSON.stringify({ type: "result", timestamp: Date.now(), data: result }) + "\n"
  }
}

// Markdown 格式化器（用于导出/复制）
export class MarkdownFormatter {
  private buffer: string[] = []
  private inCodeBlock = false
  private codeLang = ""

  write(text: string): void {
    this.buffer.push(text)
  }

  writeLine(text: string): void {
    this.buffer.push(text + "\n")
  }

  startCodeBlock(lang: string): void {
    if (this.inCodeBlock) this.endCodeBlock()
    this.inCodeBlock = true
    this.codeLang = lang
    this.buffer.push("\n```" + lang + "\n")
  }

  endCodeBlock(): void {
    if (this.inCodeBlock) {
      this.buffer.push("```\n\n")
      this.inCodeBlock = false
      this.codeLang = ""
    }
  }

  writeHeading(level: number, text: string): void {
    this.buffer.push("#".repeat(level) + " " + text + "\n\n")
  }

  writeBold(text: string): void {
    this.buffer.push("**" + text + "**")
  }

  writeItalic(text: string): void {
    this.buffer.push("*" + text + "*")
  }

  writeLink(text: string, url: string): void {
    this.buffer.push("[" + text + "](" + url + ")")
  }

  toString(): string {
    if (this.inCodeBlock) this.endCodeBlock()
    return this.buffer.join("")
  }

  clear(): void {
    this.buffer = []
  }
}

// 简单的 ANSI 颜色工具（语义色取自"东京夜"主题，对齐 gyc tui）
export const Colors = {
  reset: Typography.reset,
  bold: Typography.bold,
  dim: Typography.dim,
  italic: Typography.italic,
  underline: Typography.underline,
  red: TokyoNight.error,
  green: TokyoNight.success,
  yellow: TokyoNight.warning,
  blue: TokyoNight.info,
  magenta: TokyoNight.secondary,
  cyan: TokyoNight.primary,
  white: TokyoNight.text,
  gray: TokyoNight.textMuted,
  bgRed: "\x1b[41m",
  bgGreen: "\x1b[42m",
  bgYellow: "\x1b[43m",
  bgBlue: "\x1b[44m",
}

// 进度条渲染
export function renderProgressBar(current: number, total: number, width = 40): string {
  const pct = Math.min(1, Math.max(0, current / total))
  const filled = Math.round(pct * width)
  const empty = width - filled
  return "[" + "█".repeat(filled) + "░".repeat(empty) + "] " + Math.round(pct * 100) + "%"
}

// Spinner 帧
export const SPINNER_FRAMES = ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"]

export function createSpinner(message: string): { start: () => void; stop: () => void; update: (msg: string) => void } {
  let frame = 0
  let interval: NodeJS.Timeout | undefined
  let currentMsg = message

  const render = () => {
    process.stdout.write("\r\x1b[K" + Colors.cyan + SPINNER_FRAMES[frame] + Colors.reset + " " + currentMsg)
    frame = (frame + 1) % SPINNER_FRAMES.length
  }

  return {
    start: () => { interval = setInterval(render, 80); render() },
    stop: () => { if (interval) clearInterval(interval); process.stdout.write("\r\x1b[K") },
    update: (msg: string) => { currentMsg = msg },
  }
}