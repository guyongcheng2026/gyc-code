import { KeyParser, type Key } from "./input"
import { FallbackRenderer, type TerminalBackend } from "./terminal"

/**
 * 自研 fallback 渲染器：安全模式界面骨架。
 *
 * opentui 失效时的保底界面：标题条反白 + 消息流只读区（滚动）+
 * 单行输入 + 提示条。纯命令式更新，无 reconciler。
 */

export interface DemoAppOptions {
	backend: TerminalBackend
	title: string
	/** 初始消息（如崩溃诊断信息），每条一个字符串 */
	initialMessages?: string[]
}

export class DemoApp {
	private readonly renderer: FallbackRenderer
	private readonly parser: KeyParser
	private messages: string[]
	private input = ""
	private scrollFromBottom = 0
	private done = false

	constructor(private readonly options: DemoAppOptions) {
		this.renderer = new FallbackRenderer(options.backend)
		this.messages = [...(options.initialMessages ?? [])]
		this.parser = new KeyParser((key) => this.handleKey(key))
		options.backend.onInput((chunk) => this.parser.feed(chunk))
	}

	run(): void {
		this.renderer.start()
		this.render()
	}

	get isDone(): boolean {
		return this.done
	}

	pushMessage(text: string): void {
		this.messages.push(text)
		this.scrollFromBottom = 0
		this.render()
	}

	private handleKey(key: Key): void {
		switch (key.type) {
			case "ctrl-c":
			case "escape":
				this.stop()
				return
			case "up":
				this.scrollBy(1)
				return
			case "down":
				this.scrollBy(-1)
				return
			case "pageup":
				this.scrollBy(5)
				return
			case "pagedown":
				this.scrollBy(-5)
				return
			case "enter": {
				const text = this.input.trim()
				this.input = ""
				if (text.length > 0) this.pushMessage(`你: ${text}`)
				return
			}
			case "backspace":
				if (this.input.length > 0) {
					const chars = Array.from(this.input)
					chars.pop()
					this.input = chars.join("")
					this.render()
				}
				return
			case "text":
				this.input += key.text.replace(/\n/g, "")
				this.render()
				return
			default:
				return
		}
	}

	private scrollBy(delta: number): void {
		const max = Math.max(0, this.messages.length - 1)
		this.scrollFromBottom = Math.min(max, Math.max(0, this.scrollFromBottom + delta))
		this.render()
	}

	/** 退出安全模式并恢复终端（幂等）。 */
	stop(): void {
		this.done = true
		this.renderer.stop()
	}

	private render(): void {
		this.renderer.present((screen) => {
			const w = screen.width
			const h = screen.height
			screen.clear()
			// 标题条：反白
			screen.fillRect(0, 0, w, 1, { fg: "#ffffff", bg: "#0000aa", reverse: true })
			screen.writeText(2, 0, this.options.title.slice(0, w - 4), { fg: "#ffffff", bg: "#0000aa", reverse: true })
			// 消息区：底部对齐滚动
			const bodyTop = 1
			const inputRow = h - 2
			const visibleRows = inputRow - bodyTop
			const total = this.messages.length
			const startIdx = Math.max(0, total - visibleRows - this.scrollFromBottom)
			for (let i = 0; i < Math.min(visibleRows, total); i++) {
				screen.writeText(1, bodyTop + i, this.messages[startIdx + i]!.slice(0, w - 2))
			}
			// 输入行
			screen.fillRect(0, inputRow, w, 1, {})
			screen.writeText(0, inputRow, `> ${this.input}`.slice(0, w - 1), { bold: true })
			// 提示条
			screen.fillRect(0, h - 1, w, 1, { dim: true })
			screen.writeText(
				1,
				h - 1,
				"↑↓/PgUp/PgDn 滚动 · Enter 发送 · Esc/Ctrl+C 退出（gyc 安全模式）".slice(0, w - 2),
				{ dim: true },
			)
		})
	}
}
