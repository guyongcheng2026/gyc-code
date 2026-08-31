// 原始输入处理 - raw mode、UTF-8 解码、光标控制
// 参考 pi agent 的输入处理模式

import { EventEmitter } from "events"

export interface RawInputOptions {
  prompt: string
  initialValue?: string
  placeholder?: string
  onSubmit: (value: string) => void
  onCancel: () => void
  onTab?: (value: string, cursor: number) => Promise<string[]>
  onKeyDown?: (key: KeyEvent) => boolean
  completer?: (line: string, cursor: number) => Promise<CompletionResult>
}

export interface KeyEvent {
  sequence: string
  name: string
  ctrl: boolean
  shift: boolean
  meta: boolean
  raw: Buffer
}

export interface CompletionResult {
  suggestions: string[]
  prefixLength: number
}

export interface InputState {
  buffer: string
  cursor: number
  history: string[]
  historyIndex: number
}

// UTF-8 流式解码器
export class Utf8Decoder {
  private decoder = new TextDecoder("utf-8", { fatal: false })
  private buffer = Buffer.alloc(0)

  decode(chunk: Buffer): string {
    this.buffer = Buffer.concat([this.buffer, chunk])
    // 尝试解码完整字符，保留不完整的尾部
    let result = ""
    let lastValid = 0
    for (let i = 0; i < this.buffer.length; i++) {
      try {
        const decoded = this.decoder.decode(this.buffer.subarray(0, i + 1))
        if (decoded !== result) {
          result = decoded
          lastValid = i + 1
        }
      } catch {
        break
      }
    }
    if (lastValid > 0) {
      this.buffer = this.buffer.subarray(lastValid)
    }
    return result
  }

  flush(): string {
    const result = this.decoder.decode(this.buffer)
    this.buffer = Buffer.alloc(0)
    return result
  }
}

// ESC 序列完整性判断（调用方保证 chunk[0] === 0x1b）：不完整则等待后续分片
function isCompleteEscapeSequence(chunk: Buffer): boolean {
  if (chunk.length === 1) return false
  if (chunk[1] === 0x5b) { // CSI 序列（\x1b[...），终止符 0x40-0x7E
    for (let i = 2; i < chunk.length; i++) {
      const b = chunk[i]!
      if (b >= 0x40 && b <= 0x7e) return true
    }
    return false
  }
  if (chunk[1] === 0x4f) return chunk.length >= 3 // SS3 序列（\x1bOA 等）
  return true
}

// 原始输入处理器
export class RawInputHandler extends EventEmitter {
  private stdin: NodeJS.ReadableStream
  private stdout: NodeJS.WritableStream
  private options: RawInputOptions
  private state: InputState
  private decoder: Utf8Decoder
  private rawMode = false
  private cursorVisible = true
  private pendingChunks: Buffer[] = []
  private escapeTimer: NodeJS.Timeout | null = null

  constructor(stdin: NodeJS.ReadableStream, stdout: NodeJS.WritableStream, options: RawInputOptions) {
    super()
    this.stdin = stdin
    this.stdout = stdout
    this.options = options
    this.state = {
      buffer: options.initialValue ?? "",
      cursor: options.initialValue?.length ?? 0,
      history: [],
      historyIndex: -1,
    }
    this.decoder = new Utf8Decoder()
  }

  async start(): Promise<void> {
    this.enableRawMode()
    this.render()
    this.stdin.on("data", this.onData.bind(this))
  }

  stop(): void {
    if (this.escapeTimer !== null) {
      clearTimeout(this.escapeTimer)
      this.escapeTimer = null
    }
    this.pendingChunks = []
    this.disableRawMode()
    this.stdin.off("data", this.onData.bind(this))
  }

  private enableRawMode(): void {
    if (this.isTTY) {
      (this.stdin as NodeJS.ReadStream).setRawMode?.(true) ?? false
      this.stdin.resume()
      this.rawMode = true
      // 括号粘贴模式：粘贴内容以 \x1b[200~/\x1b[201~ 包裹，粘贴换行不再误触发提交
      this.stdout.write("\x1b[?2004h")
    }
  }

  private disableRawMode(): void {
    if (this.rawMode && this.isTTY) {
      (this.stdin as NodeJS.ReadStream).setRawMode?.(false) ?? false
      this.stdin.pause()
      this.rawMode = false
      this.stdout.write("\x1b[?2004l")
    }
    this.showCursor()
  }

  private get isTTY(): boolean {
    return typeof (this.stdin as NodeJS.WriteStream).isTTY === "boolean"
  }

  private onData(chunk: Buffer, forced = false): void {
    // ESC 序列分片容错：以 ESC 开头但序列不完整时缓存等待，50ms 超时按原样处理
    if (!forced && chunk.length > 0 && chunk[0] === 0x1b && !isCompleteEscapeSequence(chunk)) {
      this.pendingChunks.push(chunk)
      if (this.escapeTimer === null) {
        this.escapeTimer = setTimeout(() => {
          this.escapeTimer = null
          const merged = this.pendingChunks
          this.pendingChunks = []
          this.onData(Buffer.concat(merged), true)
        }, 50)
      }
      return
    }
    // 等待分片期间来了后续数据：合并处理（这些字节尚未解码，重喂安全）
    if (this.escapeTimer !== null) {
      clearTimeout(this.escapeTimer)
      this.escapeTimer = null
      chunk = Buffer.concat([...this.pendingChunks, chunk])
      this.pendingChunks = []
    }

    const text = this.decoder.decode(chunk)
    if (!text && chunk.length > 0) {
      // 可能是不完整的 UTF-8 序列，等待更多数据
      return
    }

    // 括号粘贴：包裹内容为粘贴文本，换行转空格（单行输入），避免误触发提交
    const pasteStartMark = "\x1b[200~"
    const pasteEndMark = "\x1b[201~"
    const pasteStart = text.indexOf(pasteStartMark)
    if (pasteStart >= 0) {
      const pasteEnd = text.indexOf(pasteEndMark, pasteStart)
      const pasted = text.slice(pasteStart + pasteStartMark.length, pasteEnd >= 0 ? pasteEnd : undefined)
        .replace(/\r\n|\r|\n/g, " ")
      this.feedText(text.slice(0, pasteStart))
      this.insertText(pasted)
      this.feedText(pasteEnd >= 0 ? text.slice(pasteEnd + pasteEndMark.length) : "")
      return
    }

    // 处理 ESC 开头的完整转义序列（方向键、功能键等）
    if (text.startsWith("\x1b") && isCompleteEscapeSequence(Buffer.from(text, "utf-8"))) {
      this.handleEscapeSequence(Buffer.from(text, "utf-8"))
      return
    }

    this.feedText(text)
  }

  private feedText(text: string): void {
    for (const char of text) {
      const code = char.charCodeAt(0)

      // Ctrl+C
      if (code === 3) {
        this.options.onCancel()
        return
      }

      // Enter
      if (code === 13 || code === 10) {
        const value = this.state.buffer
        // 提交行定格为对话记录并换行；清空 buffer，避免屏幕残影"删不掉"
        this.state.buffer = ""
        this.state.cursor = 0
        this.stdout.write("\r\x1b[K" + this.options.prompt + value + "\n")
        this.options.onSubmit(value)
        return
      }

      // Backspace
      if (code === 127 || code === 8) {
        if (this.state.cursor > 0) {
          this.state.buffer = this.state.buffer.slice(0, this.state.cursor - 1) + this.state.buffer.slice(this.state.cursor)
          this.state.cursor--
          this.render()
        }
        return
      }

      // Tab - 补全
      if (code === 9 && this.options.onTab) {
        this.handleTab()
        return
      }

      // 可打印字符
      if (code >= 32 || char === "\t") {
        this.insertText(char)
      }
    }
  }

  private insertText(str: string): void {
    if (!str) return
    this.state.buffer = this.state.buffer.slice(0, this.state.cursor) + str + this.state.buffer.slice(this.state.cursor)
    this.state.cursor += str.length
    this.render()
  }

  private handleEscapeSequence(chunk: Buffer): void {
    const seq = chunk.toString("utf-8")

    // 方向键
    if (seq === "\x1b[A" || seq === "\x1bOA") { // Up
      this.historyPrev()
      return
    }
    if (seq === "\x1b[B" || seq === "\x1bOB") { // Down
      this.historyNext()
      return
    }
    if (seq === "\x1b[C" || seq === "\x1bOC") { // Right
      if (this.state.cursor < this.state.buffer.length) {
        this.state.cursor++
        this.render()
      }
      return
    }
    if (seq === "\x1b[D" || seq === "\x1bOD") { // Left
      if (this.state.cursor > 0) {
        this.state.cursor--
        this.render()
      }
      return
    }

    // Home / End
    if (seq === "\x1b[H" || seq === "\x1bOH") { this.state.cursor = 0; this.render(); return }
    if (seq === "\x1b[F" || seq === "\x1bOF") { this.state.cursor = this.state.buffer.length; this.render(); return }

    // Delete
    if (seq === "\x1b[3~") {
      if (this.state.cursor < this.state.buffer.length) {
        this.state.buffer = this.state.buffer.slice(0, this.state.cursor) + this.state.buffer.slice(this.state.cursor + 1)
        this.render()
      }
      return
    }

    // Ctrl+键组合
    if (seq.startsWith("\x1b[")) {
      // 更多组合键...
    }

    // 单独的 Escape - 取消
    this.options.onCancel()
  }

  private async handleTab(): Promise<void> {
    if (!this.options.onTab) return
    const suggestions = await this.options.onTab(this.state.buffer, this.state.cursor)
    if (suggestions.length === 1) {
      // 单一补全，直接应用
      const completion = suggestions[0]
      const prefix = this.state.buffer.slice(0, this.state.cursor)
      // 简单的前缀匹配补全
      if (completion.startsWith(prefix)) {
        const suffix = completion.slice(prefix.length)
        this.state.buffer = prefix + suffix + this.state.buffer.slice(this.state.cursor)
        this.state.cursor = prefix.length + suffix.length
        this.render()
      }
    } else if (suggestions.length > 1) {
      // 多选项，触发菜单显示（由上层处理）
      this.emit("completions", suggestions)
    }
  }

  private historyPrev(): void {
    if (this.state.history.length === 0) return
    if (this.state.historyIndex === -1) {
      this.state.historyIndex = this.state.history.length - 1
    } else if (this.state.historyIndex > 0) {
      this.state.historyIndex--
    }
    this.state.buffer = this.state.history[this.state.historyIndex]
    this.state.cursor = this.state.buffer.length
    this.render()
  }

  private historyNext(): void {
    if (this.state.historyIndex === -1) return
    if (this.state.historyIndex < this.state.history.length - 1) {
      this.state.historyIndex++
      this.state.buffer = this.state.history[this.state.historyIndex]
    } else {
      this.state.historyIndex = -1
      this.state.buffer = ""
    }
    this.state.cursor = this.state.buffer.length
    this.render()
  }

  addToHistory(entry: string): void {
    if (!entry.trim()) return
    this.state.history.push(entry)
    if (this.state.history.length > 1000) this.state.history.shift()
    this.state.historyIndex = -1
  }

  getValue(): string {
    return this.state.buffer
  }

  getCursor(): number {
    return this.state.cursor
  }

  setValue(value: string): void {
    this.state.buffer = value
    this.state.cursor = value.length
    this.render()
  }

  /** 上层输出（AI 回复等）结束后重新渲染输入提示行 */
  redraw(): void {
    this.render()
  }

  private render(): void {
    const { prompt } = this.options
    const prefixWidth = this.getDisplayWidth(prompt)
    this.stdout.write("\r\x1b[K" + prompt + this.state.buffer)
    const col = prefixWidth + this.getDisplayWidth(this.state.buffer.slice(0, this.state.cursor)) + 1
    this.stdout.write("\x1b[" + col + "G")
  }

  private getDisplayWidth(str: string): number {
    let width = 0
    for (const char of str) {
      const code = char.charCodeAt(0)
      if (code >= 0x1100 && (code <= 0x115F || code === 0x2329 || code === 0x232A ||
        (code >= 0x2E80 && code <= 0xA4CF) ||
        (code >= 0xAC00 && code <= 0xD7A3) ||
        (code >= 0xF900 && code <= 0xFAFF) ||
        (code >= 0xFE10 && code <= 0xFE1F) ||
        (code >= 0xFE30 && code <= 0xFE6F) ||
        (code >= 0xFF00 && code <= 0xFF60) ||
        (code >= 0xFFE0 && code <= 0xFFE6))) {
        width += 2
      } else {
        width += 1
      }
    }
    return width
  }

  private hideCursor(): void {
    if (this.cursorVisible) {
      this.stdout.write("\x1b[?25l")
      this.cursorVisible = false
    }
  }

  private showCursor(): void {
    if (!this.cursorVisible) {
      this.stdout.write("\x1b[?25h")
      this.cursorVisible = true
    }
  }
}

// 简单的行读取器（非 raw mode，用于密码等）
export async function readLine(prompt: string): Promise<string> {
  const { createInterface } = await import("node:readline/promises")
  const rl = createInterface({ input: process.stdin, output: process.stdout })
  try {
    return await rl.question(prompt)
  } finally {
    rl.close()
    try {
      process.stdin.pause()
    } catch {
      // stdin 可能已被销毁，暂停失败无需处理
    }
  }
}

// 密码输入（隐藏回显）
export async function readPassword(prompt: string): Promise<string> {
  const { createInterface } = await import("node:readline/promises")
  const rl = createInterface({ input: process.stdin, output: process.stdout })
  const stdin = process.stdin
  let password = ""

  if (stdin.isTTY) {
    stdin.setRawMode(true)
    stdin.resume()
  }

  process.stdout.write(prompt)

  return new Promise((resolve) => {
    const onData = (chunk: Buffer) => {
      for (const byte of chunk) {
        if (byte === 13 || byte === 10) { // Enter
          process.stdout.write("\n")
          cleanup()
          resolve(password)
          return
        }
        if (byte === 3) { // Ctrl+C
          process.stdout.write("\n")
          cleanup()
          resolve("")
          return
        }
        if (byte === 127 || byte === 8) { // Backspace
          if (password.length > 0) {
            password = password.slice(0, -1)
            process.stdout.write("\r\x1b[K" + prompt + "*".repeat(password.length))
          }
          return
        }
        if (byte >= 32) {
          password += String.fromCharCode(byte)
          process.stdout.write("*")
        }
      }
    }
    stdin.on("data", onData)

    const cleanup = () => {
      stdin.off("data", onData)
      if (stdin.isTTY) {
        stdin.setRawMode(false)
        stdin.pause()
      }
      rl.close()
    }
  })
}