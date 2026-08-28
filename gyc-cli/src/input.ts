// gyc cli 终端行输入：raw mode + UTF-8 流式解码 + 光标自绘（对齐 gyc cli 主程序同款机制）
// 光标完全自控：\r\x1b[K 整行重绘 + \x1b[<col>G 列定位——光标永远紧贴提示符后第一个输入位
// 中文宽字符按 2 列计算（displayWidth），避免 CJK 输入时光标错位

import { EventEmitter } from "node:events"

export interface RawInputOptions {
  prompt: string
  initialValue?: string
  onSubmit: (value: string) => void | Promise<void>
  onCancel: () => void
  /** 输入内容变化时回调（含历史切换、补全填充），用于联动斜杠命令菜单 */
  onChange?: (value: string) => void
  /** 方向键拦截：返回 true 表示已消费（如菜单上下移动），不再走历史 */
  onArrow?: (direction: "up" | "down") => boolean
  /** Tab 键回调（菜单选中补全等） */
  onTab?: () => void
}

export interface InputState {
  buffer: string
  cursor: number
  history: string[]
  historyIndex: number
}

type StdinLike = NodeJS.ReadableStream & { setRawMode?: (mode: boolean) => unknown }

/** 终端显示宽度：CJK 全角字符按 2 列，其余按 1 列 */
export function displayWidth(text: string): number {
  let width = 0
  for (const char of text) {
    const code = char.codePointAt(0) ?? 0
    const wide =
      (code >= 0x1100 && code <= 0x115f) ||
      code === 0x2329 ||
      code === 0x232a ||
      (code >= 0x2e80 && code <= 0xa4cf) ||
      (code >= 0xac00 && code <= 0xd7a3) ||
      (code >= 0xf900 && code <= 0xfaff) ||
      (code >= 0xfe10 && code <= 0xfe1f) ||
      (code >= 0xfe30 && code <= 0xfe6f) ||
      (code >= 0xff00 && code <= 0xff60) ||
      (code >= 0xffe0 && code <= 0xffe6)
    width += wide ? 2 : 1
  }
  return width
}

// UTF-8 流式解码器：多字节字符分片到达时由 TextDecoder stream 模式保留尾部等待重组
class Utf8Decoder {
  private readonly decoder = new TextDecoder("utf-8", { fatal: false })

  decode(chunk: Buffer): string {
    return this.decoder.decode(chunk, { stream: true })
  }

  flush(): string {
    return this.decoder.decode()
  }
}

// ESC 序列完整性判断（调用方保证 chunk[0] === 0x1b）：不完整则等待后续分片
function isCompleteEscapeSequence(chunk: Buffer): boolean {
  if (chunk.length === 1) return false
  if (chunk[1] === 0x5b) {
    // CSI 序列（\x1b[...）：终止符 0x40-0x7E
    for (let i = 2; i < chunk.length; i++) {
      const b = chunk[i]!
      if (b >= 0x40 && b <= 0x7e) return true
    }
    return false
  }
  if (chunk[1] === 0x4f) return chunk.length >= 3 // SS3 序列（\x1bOA 等）
  return true
}

const PASTE_START = "\x1b[200~"
const PASTE_END = "\x1b[201~"

/** 原始输入处理器：单行编辑 + 历史 + 括号粘贴 + 光标自绘 */
export class RawInputHandler extends EventEmitter {
  private readonly stdin: StdinLike
  private readonly stdout: NodeJS.WritableStream
  private readonly options: RawInputOptions
  private state: InputState
  private readonly decoder = new Utf8Decoder()
  private rawMode = false
  private pendingChunks: Buffer[] = []
  private escapeTimer: NodeJS.Timeout | null = null

  constructor(stdin: StdinLike, stdout: NodeJS.WritableStream, options: RawInputOptions) {
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
  }

  private get isTTY(): boolean {
    return (this.stdin as Partial<NodeJS.ReadStream>).isTTY === true
  }

  async start(): Promise<void> {
    this.enableRawMode()
    this.stdin.on("data", this.onData)
    this.stdin.resume()
    this.render()
  }

  stop(): void {
    if (this.escapeTimer !== null) {
      clearTimeout(this.escapeTimer)
      this.escapeTimer = null
    }
    this.pendingChunks = []
    this.stdin.off("data", this.onData)
    this.disableRawMode()
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
    this.notifyChange()
  }

  addToHistory(entry: string): void {
    const text = entry.trim()
    if (!text) return
    this.state.history.push(text)
    if (this.state.history.length > 1000) this.state.history.shift()
    this.state.historyIndex = -1
  }

  /** 重绘输入行并把光标定位到正确列（供菜单等外部区域刷新后调用） */
  redraw(): void {
    this.render()
  }

  private enableRawMode(): void {
    if (this.isTTY && this.stdin.setRawMode) {
      this.stdin.setRawMode(true)
      this.rawMode = true
      // 括号粘贴模式：粘贴内容以 \x1b[200~/\x1b[201~ 包裹，粘贴换行不再误触发提交
      this.stdout.write("\x1b[?2004h")
    }
  }

  private disableRawMode(): void {
    if (this.rawMode && this.stdin.setRawMode) {
      this.stdin.setRawMode(false)
      this.stdin.pause()
      this.rawMode = false
      this.stdout.write("\x1b[?2004l")
    }
  }

  // 类字段箭头函数：on/off 引用稳定（避免 bind 产生新引用导致监听器泄漏）
  private readonly onData = (chunk: Buffer, forced = false): void => {
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
    if (this.escapeTimer !== null) {
      clearTimeout(this.escapeTimer)
      this.escapeTimer = null
      chunk = Buffer.concat([...this.pendingChunks, chunk])
      this.pendingChunks = []
    }

    const text = this.decoder.decode(chunk)
    if (!text) return

    // 括号粘贴：包裹内容为粘贴文本，换行转空格（单行输入），避免误触发提交
    const pasteStart = text.indexOf(PASTE_START)
    if (pasteStart >= 0) {
      const pasteEnd = text.indexOf(PASTE_END, pasteStart)
      const pasted = text
        .slice(pasteStart + PASTE_START.length, pasteEnd >= 0 ? pasteEnd : undefined)
        .replace(/\r\n|\r|\n/g, " ")
      this.feedText(text.slice(0, pasteStart))
      this.insertText(pasted)
      if (pasteEnd >= 0) this.feedText(text.slice(pasteEnd + PASTE_END.length))
      return
    }

    // 组合键序列整体处理（\x1b[ / \x1bO 开头），避免逐字符喂入误触发单键 Esc
    if (text.startsWith("\x1b[") || text.startsWith("\x1bO")) {
      this.handleEscapeSequence(text)
      return
    }

    this.feedText(text)
  }

  private feedText(text: string): void {
    for (const char of text) {
      const code = char.charCodeAt(0)
      if (code === 3) {
        this.options.onCancel()
        return
      }
      if (code === 13 || code === 10) {
        this.submitLine()
        return
      }
      if (code === 127 || code === 8) {
        this.backspace()
        continue
      }
      if (code === 9) {
        this.options.onTab?.()
        continue
      }
      if (code >= 32) this.insertText(char)
    }
  }

  private submitLine(): void {
    const value = this.state.buffer
    // 提交行定格为对话记录并换行；清空 buffer，避免屏幕残影"删不掉"
    this.state.buffer = ""
    this.state.cursor = 0
    if (this.isTTY) this.stdout.write(`\r\x1b[K${this.options.prompt}${value}\n`)
    void this.options.onSubmit(value)
    this.notifyChange()
  }

  private insertText(text: string): void {
    if (!text) return
    const { buffer, cursor } = this.state
    this.state.buffer = buffer.slice(0, cursor) + text + buffer.slice(cursor)
    this.state.cursor = cursor + text.length
    this.render()
    this.notifyChange()
  }

  private backspace(): void {
    const { cursor } = this.state
    if (cursor <= 0) return
    const { buffer } = this.state
    this.state.buffer = buffer.slice(0, cursor - 1) + buffer.slice(cursor)
    this.state.cursor = cursor - 1
    this.render()
    this.notifyChange()
  }

  private deleteForward(): void {
    const { buffer, cursor } = this.state
    if (cursor >= buffer.length) return
    this.state.buffer = buffer.slice(0, cursor) + buffer.slice(cursor + 1)
    this.render()
    this.notifyChange()
  }

  private moveCursor(delta: 1 | -1): void {
    const next = this.state.cursor + delta
    if (next < 0 || next > this.state.buffer.length) return
    this.state.cursor = next
    this.render()
  }

  private handleEscapeSequence(seq: string): void {
    if (seq === "\x1b[A" || seq === "\x1bOA") return this.arrow("up")
    if (seq === "\x1b[B" || seq === "\x1bOB") return this.arrow("down")
    if (seq === "\x1b[C" || seq === "\x1bOC") return this.moveCursor(1)
    if (seq === "\x1b[D" || seq === "\x1bOD") return this.moveCursor(-1)
    if (seq === "\x1b[H" || seq === "\x1bOH" || seq === "\x1b[1~") {
      this.state.cursor = 0
      this.render()
      return
    }
    if (seq === "\x1b[F" || seq === "\x1bOF" || seq === "\x1b[4~") {
      this.state.cursor = this.state.buffer.length
      this.render()
      return
    }
    if (seq === "\x1b[3~") return this.deleteForward()
    // 未知序列忽略
  }

  private arrow(direction: "up" | "down"): void {
    if (this.options.onArrow?.(direction) === true) return
    if (direction === "up") this.historyPrev()
    else this.historyNext()
  }

  private historyPrev(): void {
    const { history, historyIndex } = this.state
    if (history.length === 0) return
    const next = historyIndex === -1 ? history.length - 1 : Math.max(0, historyIndex - 1)
    this.state.historyIndex = next
    this.state.buffer = history[next] ?? ""
    this.state.cursor = this.state.buffer.length
    this.render()
    this.notifyChange()
  }

  private historyNext(): void {
    const { history, historyIndex } = this.state
    if (historyIndex === -1) return
    const next = historyIndex < history.length - 1 ? historyIndex + 1 : -1
    this.state.historyIndex = next
    this.state.buffer = next === -1 ? "" : (history[next] ?? "")
    this.state.cursor = this.state.buffer.length
    this.render()
    this.notifyChange()
  }

  private notifyChange(): void {
    this.options.onChange?.(this.state.buffer)
  }

  /** 整行重绘 + 列定位：光标永远落在提示符后正确位置（非 TTY 不写控制序列） */
  private render(): void {
    if (!this.isTTY) return
    const col =
      displayWidth(this.options.prompt) + displayWidth(this.state.buffer.slice(0, this.state.cursor)) + 1
    this.stdout.write(`\r\x1b[K${this.options.prompt}${this.state.buffer}\x1b[${col}G`)
  }
}
