/**
 * 自研 fallback 渲染器：最小按键解析。
 *
 * 流式解析 stdin UTF-8 chunk。raw mode 下终端通常一次读取交付完整
 * 转义序列；跨 chunk 截断的 CSI 前缀会等待后续数据。
 * 明确不做：鼠标、kitty 键盘协议、修饰键组合矩阵。超纲即砍。
 */

export type Key =
	| { type: "up" }
	| { type: "down" }
	| { type: "left" }
	| { type: "right" }
	| { type: "pageup" }
	| { type: "pagedown" }
	| { type: "home" }
	| { type: "end" }
	| { type: "enter" }
	| { type: "backspace" }
	| { type: "escape" }
	| { type: "ctrl-c" }
	| { type: "text"; text: string }
	| { type: "cursor-request"; row: number; col: number }
	/** SGR 鼠标事件：button=0 左键/1 中键/2 右键/64 上滚/65 下滚；motion 指示移动事件；press=false 为释放 */
	| { type: "mouse"; button: number; x: number; y: number; motion: boolean; press: boolean }

/** 未识别转义序列的丢弃上限：超过即放弃前缀，防止病态输入撑爆缓冲 */
const MAX_SEQ = 32

const CSI_KEYS: Record<string, Key> = {
	"\x1b[A": { type: "up" },
	"\x1b[B": { type: "down" },
	"\x1b[C": { type: "right" },
	"\x1b[D": { type: "left" },
	"\x1b[H": { type: "home" },
	"\x1b[F": { type: "end" },
}

const TILDE_KEYS: Record<number, Key> = {
	1: { type: "home" },
	4: { type: "end" },
	5: { type: "pageup" },
	6: { type: "pagedown" },
	7: { type: "home" },
	8: { type: "end" },
}

/**
 * 启用 SGR（1006）鼠标追踪。
 * 调用后终端会以 SGR 格式上报鼠标事件，KeyParser 负责解析。
 * @param write 终端写入函数（stdout.write 或 backend.write）
 */
export function setSgrMouse(write: (data: string) => void): void {
	write("\x1b[?1006h\x1b[?1002h\x1b[?1005h")
}

/**
 * 禁用 SGR 鼠标追踪。
 */
export function disableMouse(write: (data: string) => void): void {
	write("\x1b[?1006l\x1b[?1002l\x1b[?1005l")
}

export class KeyParser {
	private buf = ""

	constructor(private readonly onKey: (key: Key) => void) {}

	feed(chunk: string): void {
		this.buf += chunk
		while (this.parseOne()) {}
	}

	private parseOne(): boolean {
		if (this.buf.length === 0) return false
		const head = this.buf[0]!
		if (head === "\x1b") return this.consumeSequence()
		if (head === "\x03") {
			this.buf = this.buf.slice(1)
			this.onKey({ type: "ctrl-c" })
			return true
		}
		if (head === "\r" || head === "\n") {
			this.buf = this.buf.slice(1)
			this.onKey({ type: "enter" })
			return true
		}
		if (head === "\x7f" || head === "\b") {
			this.buf = this.buf.slice(1)
			this.onKey({ type: "backspace" })
			return true
		}
		if (head < " ") {
			// 其余控制字符丢弃
			this.buf = this.buf.slice(1)
			return true
		}
		if (head !== "\x1b") {
			this.consumeText()
			return true
		}
		return this.consumeSequence()
	}

	private consumeText(): void {
		let end = 0
		while (end < this.buf.length) {
			const ch = this.buf[end]!
			if (ch === "\x1b" || ch === "\r" || ch === "\n" || ch === "\x7f" || ch === "\b" || ch < " ") break
			end += 1
		}
		const text = this.buf.slice(0, end)
		this.buf = this.buf.slice(end)
		if (text.length > 0) this.onKey({ type: "text", text })
	}

	private consumeSequence(): boolean {
		if (this.buf.startsWith("\x1b\x03")) {
			this.buf = this.buf.slice(2)
			this.onKey({ type: "ctrl-c" })
			return true
		}
		if (this.buf.length === 1) {
			this.buf = ""
			this.onKey({ type: "escape" })
			return true
		}
		const csi3 = this.buf.slice(0, 3)
		const named = CSI_KEYS[csi3]
		if (named) {
			this.buf = this.buf.slice(3)
			this.onKey(named)
			return true
		}
		const tilde = /^(\x1b\[(\d+)~)/.exec(this.buf)
		if (tilde?.[0]) {
			const code = Number(tilde[2])
			this.buf = this.buf.slice(tilde[0].length)
			const key = TILDE_KEYS[code]
			if (key) this.onKey(key)
			return true
		}
		// DSR (Device Status Report) 响应：\x1b[row;colR，光标位置查询（用于 IME 悬浮窗定位）
		const dsr = /^\x1b\[(\d+);(\d+)R/.exec(this.buf)
		if (dsr) {
			this.buf = this.buf.slice(dsr[0].length)
			this.onKey({ type: "cursor-request", row: Number(dsr[1]), col: Number(dsr[2]) })
			return true
		}
		// SGR 鼠标追踪：\x1b[<bbb;xxx;yyyM (press) 或 \x1b[<bbb;xxx;yyym (release)
		// bbb=按钮编码 (0左/1中/2右/64上滚/65下滚，+32=motion，+128=release)
		const sgr = /^\x1b\[<(\d+);(\d+);(\d+)([Mm])/.exec(this.buf)
		if (sgr) {
			this.buf = this.buf.slice(sgr[0].length)
			const b = Number(sgr[1])
			const x = Number(sgr[2])
			const y = Number(sgr[3])
			const isRelease = sgr[4] === "m"
			this.onKey({ type: "mouse", button: b & ~32 & ~128, x, y, motion: (b & 32) !== 0, press: !isRelease })
			return true
		}
		// 不完整的 CSI 序列（如 "\x1b["）：等待下一 chunk 拼齐
		if (/^\x1b\[[\d;]*$/.test(this.buf)) return false
		// 无法识别的序列：丢弃 ESC 前缀后按文本继续解析
		if (this.buf.length >= MAX_SEQ || !/^\x1b\[/.test(this.buf)) {
			this.buf = this.buf.slice(1)
			return true
		}
		return false
	}
}
