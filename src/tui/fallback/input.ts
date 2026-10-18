/**
 * 自研 fallback 渲染器：按键解析。
 *
 * 流式解析 stdin UTF-8 chunk。raw mode 下终端通常一次读取交付完整
 * 转义序列；跨 chunk 截断的 CSI 前缀会等待后续数据。
 *
 * M3 起覆盖：
 *  - 方向/翻页/Home/End（CSI 与 tilde 两套编码）
 *  - 修饰键矩阵：CSI `1;{mod}{A|B|C|D|H|F}`、`{code};{mod}~`、kitty `{code};{mod}u`
 *  - bracketed paste（`\x1b[200~ … \x1b[201~`，可跨 chunk）
 *  - 焦点事件（`\x1b[I` / `\x1b[O`）
 *  - SGR 鼠标（1006）、DSR 光标位置响应
 * 明确不做：kitty 的 release/repeat 事件位（需启用 `events` flag，产线未用）。
 */

/** 修饰键位（kitty/xterm 的 `mod = 1 + shift(1) + alt(2) + ctrl(4) + meta(8)`）。 */
export interface KeyModifiers {
	readonly shift: boolean
	readonly alt: boolean
	readonly ctrl: boolean
	readonly meta: boolean
}

type KeyBase =
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
	/** Ctrl+字母（a–z，去掉 ctrl-c/backspace/tab 等已被专用分支消费的码位） */
	| { type: "ctrl"; key: string }
	/** bracketed paste：整段文本（换行原样保留，不触发 Enter 提交） */
	| { type: "paste"; text: string }
	/** 终端焦点变化（需启用 1004） */
	| { type: "focus"; focused: boolean }
	| { type: "cursor-request"; row: number; col: number }
	/** SGR 鼠标事件：button=0 左键/1 中键/2 右键/64 上滚/65 下滚；motion 指示移动事件；press=false 为释放 */
	| { type: "mouse"; button: number; x: number; y: number; motion: boolean; press: boolean }

export type Key = KeyBase & { readonly modifiers?: KeyModifiers }

/** 由 xterm/kitty 的 mod 数值解析修饰键（1 表示无修饰）。 */
export function parseModifiers(code: number): KeyModifiers {
	const bits = Math.max(0, code - 1)
	return {
		shift: (bits & 1) !== 0,
		alt: (bits & 2) !== 0,
		ctrl: (bits & 4) !== 0,
		meta: (bits & 8) !== 0,
	}
}

/** 启用 bracketed paste（1004 焦点追踪由 setFocusTracking 单独控制）。 */
export function setBracketedPaste(write: (data: string) => void): void {
	write("\x1b[?2004h")
}

export function disableBracketedPaste(write: (data: string) => void): void {
	write("\x1b[?2004l")
}

/** 启用终端焦点追踪（`\x1b[I` / `\x1b[O`）。 */
export function setFocusTracking(write: (data: string) => void): void {
	write("\x1b[?1004h")
}

export function disableFocusTracking(write: (data: string) => void): void {
	write("\x1b[?1004l")
}

/** 未识别转义序列的丢弃上限：超过即放弃前缀，防止病态输入撑爆缓冲 */
const MAX_SEQ = 32

const PASTE_START = "\x1b[200~"
const PASTE_END = "\x1b[201~"

/** CSI 字母 → 方向/定位键（带修饰键时用 `1;{mod}{letter}` 编码）。 */
const CSI_LETTER_TYPES: Record<string, "up" | "down" | "right" | "left" | "home" | "end"> = {
	A: "up",
	B: "down",
	C: "right",
	D: "left",
	H: "home",
	F: "end",
}

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
	/** bracketed paste 未闭合时的已收内容（跨 chunk） */
	private paste: string | undefined

	constructor(private readonly onKey: (key: Key) => void) {}

	feed(chunk: string): void {
		this.buf += chunk
		while (this.parseOne()) {}
	}

	private parseOne(): boolean {
		if (this.paste !== undefined) return this.consumePaste()
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
			// 其余控制字符：0x01–0x1a 映射为 Ctrl+字母（编辑器快捷键用），
			// 0x00/0x1b 之后等异常码位直接丢弃
			this.buf = this.buf.slice(1)
			const code = head.charCodeAt(0)
			if (code >= 1 && code <= 26) {
				this.onKey({ type: "ctrl", key: String.fromCharCode(96 + code) })
			}
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

	/** 粘贴收尾：找到 `\x1b[201~` 即发整段；未找到则继续累积（跨 chunk）。 */
	private consumePaste(): boolean {
		const end = this.buf.indexOf(PASTE_END)
		if (end < 0) {
			this.paste += this.buf
			this.buf = ""
			return false
		}
		const text = this.paste + this.buf.slice(0, end)
		this.buf = this.buf.slice(end + PASTE_END.length)
		this.paste = undefined
		this.onKey({ type: "paste", text })
		return true
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
		// bracketed paste 开始：整段收集到 201~ 再一次性交付（内部换行不触发 Enter）
		if (this.buf.startsWith(PASTE_START)) {
			const end = this.buf.indexOf(PASTE_END, PASTE_START.length)
			if (end < 0) {
				this.paste = this.buf.slice(PASTE_START.length)
				this.buf = ""
				return false
			}
			this.onKey({ type: "paste", text: this.buf.slice(PASTE_START.length, end) })
			this.buf = this.buf.slice(end + PASTE_END.length)
			return true
		}
		// 焦点事件（需启用 1004）
		if (this.buf.startsWith("\x1b[I")) {
			this.buf = this.buf.slice(3)
			this.onKey({ type: "focus", focused: true })
			return true
		}
		if (this.buf.startsWith("\x1b[O")) {
			this.buf = this.buf.slice(3)
			this.onKey({ type: "focus", focused: false })
			return true
		}
		// kitty 键盘协议 CSI u：\x1b[{code}u 或 \x1b[{code};{mod}u
		const csiU = /^\x1b\[(\d+)(?:;(\d+))?u/.exec(this.buf)
		if (csiU) {
			const code = Number(csiU[1])
			const mod = csiU[2] === undefined ? 1 : Number(csiU[2])
			this.buf = this.buf.slice(csiU[0].length)
			const text = code > 0 && code <= 0x10ffff ? String.fromCodePoint(code) : ""
			if (text.length > 0) this.onKey({ type: "text", text, modifiers: parseModifiers(mod) })
			return true
		}
		// xterm 修饰键方向键：\x1b[1;{mod}{A|B|C|D|H|F}
		const modLetter = /^\x1b\[1;(\d+)([ABCDHF])/.exec(this.buf)
		if (modLetter) {
			const type = CSI_LETTER_TYPES[modLetter[2]!]
			this.buf = this.buf.slice(modLetter[0].length)
			if (type !== undefined) this.onKey({ type, modifiers: parseModifiers(Number(modLetter[1])) } as Key)
			return true
		}
		const csi3 = this.buf.slice(0, 3)
		const named = CSI_KEYS[csi3]
		if (named) {
			this.buf = this.buf.slice(3)
			this.onKey(named)
			return true
		}
		// tilde 键：{code}~ 或 {code};{mod}~
		const tilde = /^\x1b\[(\d+)(?:;(\d+))?~/.exec(this.buf)
		if (tilde?.[0]) {
			const code = Number(tilde[1])
			const mod = tilde[2] === undefined ? undefined : parseModifiers(Number(tilde[2]))
			this.buf = this.buf.slice(tilde[0].length)
			const key = TILDE_KEYS[code]
			if (key) this.onKey(mod === undefined ? key : ({ ...key, modifiers: mod } as Key))
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
