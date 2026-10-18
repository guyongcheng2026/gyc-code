/**
 * M4：编辑缓冲（对齐 opentui `EditBuffer` + `extmarks` 的核心子集）。
 *
 * 为什么需要独立模型：现有 `Textarea` 组件把「行数组 + 光标」塞在组件内部
 * （`solid/components.tsx:103-233`），导致无法支持 undo/redo、跨行选择、
 * 以及产线 prompt 依赖的 extmarks（`prompt/index.tsx:1510` 注册 `prompt-part`
 * 类型来标记附件与粘贴片段）。
 *
 * 口径（与现有 Textarea 保持一致，避免迁移时行为漂移）：
 *  - 列号按 **code point** 计（不是 UTF-16 单元），代理对/emoji 安全；
 *  - 行内不存换行符，`text` 用 `\n` 拼接；
 *  - 光标可位于行尾（col === 行长），这是插入位置而非字符位置。
 *
 * 明确不做：kill ring 多级 yank、语法高亮区间（M5）、虚拟行（后续按需）。
 */

export interface Cursor {
	readonly row: number
	readonly col: number
}

export interface Extmark {
	readonly id: number
	readonly type: string
	/** 绝对偏移（按 code point 计，跨行连续） */
	start: number
	end: number
	readonly meta?: unknown
}

interface Snapshot {
	readonly lines: readonly string[]
	readonly row: number
	readonly col: number
}

const UNDO_LIMIT = 100

/** code point 长度（光标列口径）。 */
function cpLength(text: string): number {
	let n = 0
	for (const _ of text) n += 1
	return n
}

function cpSlice(text: string, start: number, end?: number): string {
	return Array.from(text).slice(start, end).join("")
}

export class EditBuffer {
	private lines: string[]
	private row = 0
	private col = 0
	private anchor: Cursor | undefined
	private undoStack: Snapshot[] = []
	private redoStack: Snapshot[] = []
	private marks: Extmark[] = []
	private nextMarkId = 1
	private readonly markTypes = new Map<string, number>()

	constructor(initial = "") {
		this.lines = initial.length > 0 ? initial.split("\n") : [""]
	}

	get text(): string {
		return this.lines.join("\n")
	}

	get cursor(): Cursor {
		return { row: this.row, col: this.col }
	}

	get lineCount(): number {
		return this.lines.length
	}

	lineAt(row: number): string {
		return this.lines[row] ?? ""
	}

	get linesSnapshot(): readonly string[] {
		return this.lines
	}

	// ---------- 基础操作 ----------

	setText(text: string): void {
		this.pushUndo()
		this.lines = text.length > 0 ? text.split("\n") : [""]
		this.row = 0
		this.col = 0
		this.anchor = undefined
		this.rebaseMarks()
	}

	insert(text: string): void {
		if (text.length === 0) return
		this.pushUndo()
		const normalized = text.replace(/\r\n/g, "\n").replace(/\r/g, "\n")
		const offset = this.offsetOf(this.row, this.col)
		const segments = normalized.split("\n")
		const current = Array.from(this.lines[this.row] ?? "")
		const before = current.slice(0, this.col).join("")
		const after = current.slice(this.col).join("")

		if (segments.length === 1) {
			this.lines[this.row] = before + normalized + after
			this.col += cpLength(normalized)
		} else {
			const head = before + segments[0]!
			const tail = segments[segments.length - 1]! + after
			const middle = segments.slice(1, -1)
			this.lines.splice(this.row, 1, head, ...middle, tail)
			this.row += segments.length - 1
			this.col = cpLength(segments[segments.length - 1]!)
		}
		this.shiftMarks(offset, cpLength(normalized), true)
	}

	backspace(): void {
		if (this.col > 0) {
			this.pushUndo()
			const chars = Array.from(this.lines[this.row] ?? "")
			chars.splice(this.col - 1, 1)
			this.lines[this.row] = chars.join("")
			this.col -= 1
			this.shiftMarks(this.offsetOf(this.row, this.col), 1, false)
			return
		}
		if (this.row > 0) {
			this.pushUndo()
			const prev = this.lines[this.row - 1] ?? ""
			const cur = this.lines[this.row] ?? ""
			const joinOffset = this.offsetOf(this.row - 1, cpLength(prev))
			this.lines.splice(this.row - 1, 2, prev + cur)
			this.row -= 1
			this.col = cpLength(prev)
			this.shiftMarks(joinOffset, 1, false)
		}
	}

	deleteForward(): void {
		const chars = Array.from(this.lines[this.row] ?? "")
		if (this.col < chars.length) {
			this.pushUndo()
			chars.splice(this.col, 1)
			this.lines[this.row] = chars.join("")
			this.shiftMarks(this.offsetOf(this.row, this.col), 1, false)
			return
		}
		if (this.row < this.lines.length - 1) {
			this.pushUndo()
			const joinOffset = this.offsetOf(this.row, this.col)
			this.lines.splice(this.row, 2, (this.lines[this.row] ?? "") + (this.lines[this.row + 1] ?? ""))
			this.shiftMarks(joinOffset, 1, false)
		}
	}

	/** Ctrl+W：删除光标前一个词（先吞空格，再吞非空格）。 */
	deleteWordBefore(): void {
		const chars = Array.from(this.lines[this.row] ?? "")
		let col = this.col
		while (col > 0 && chars[col - 1] === " ") col -= 1
		while (col > 0 && chars[col - 1] !== " ") col -= 1
		if (col === this.col) return
		this.pushUndo()
		const offset = this.offsetOf(this.row, col)
		const removed = this.col - col
		chars.splice(col, removed)
		this.lines[this.row] = chars.join("")
		this.col = col
		this.shiftMarks(offset, removed, false)
	}

	/** Ctrl+K：删到行尾；已在行尾则合并下一行。 */
	killToLineEnd(): string {
		const chars = Array.from(this.lines[this.row] ?? "")
		if (this.col < chars.length) {
			this.pushUndo()
			const removed = chars.slice(this.col).join("")
			this.lines[this.row] = chars.slice(0, this.col).join("")
			this.shiftMarks(this.offsetOf(this.row, this.col), cpLength(removed), false)
			return removed
		}
		if (this.row < this.lines.length - 1) {
			this.pushUndo()
			const joinOffset = this.offsetOf(this.row, this.col)
			this.lines.splice(this.row, 2, (this.lines[this.row] ?? "") + (this.lines[this.row + 1] ?? ""))
			this.shiftMarks(joinOffset, 1, false)
		}
		return ""
	}

	/** Ctrl+U：删到行首。 */
	killToLineStart(): string {
		if (this.col === 0) return ""
		this.pushUndo()
		const chars = Array.from(this.lines[this.row] ?? "")
		const removed = chars.slice(0, this.col).join("")
		this.lines[this.row] = chars.slice(this.col).join("")
		this.shiftMarks(this.offsetOf(this.row, 0), this.col, false)
		this.col = 0
		return removed
	}

	// ---------- 光标移动 ----------

	moveLeft(): void {
		if (this.col > 0) this.col -= 1
		else if (this.row > 0) {
			this.row -= 1
			this.col = cpLength(this.lines[this.row] ?? "")
		}
	}

	moveRight(): void {
		const len = cpLength(this.lines[this.row] ?? "")
		if (this.col < len) this.col += 1
		else if (this.row < this.lines.length - 1) {
			this.row += 1
			this.col = 0
		}
	}

	moveUp(): void {
		if (this.row === 0) return
		this.row -= 1
		this.col = Math.min(this.col, cpLength(this.lines[this.row] ?? ""))
	}

	moveDown(): void {
		if (this.row >= this.lines.length - 1) return
		this.row += 1
		this.col = Math.min(this.col, cpLength(this.lines[this.row] ?? ""))
	}

	moveLineStart(): void {
		this.col = 0
	}

	moveLineEnd(): void {
		this.col = cpLength(this.lines[this.row] ?? "")
	}

	setCursor(row: number, col: number): void {
		this.row = Math.max(0, Math.min(row, this.lines.length - 1))
		this.col = Math.max(0, Math.min(col, cpLength(this.lines[this.row] ?? "")))
	}

	// ---------- 选择 ----------

	beginSelection(): void {
		this.anchor = this.cursor
	}

	clearSelection(): void {
		this.anchor = undefined
	}

	get hasSelection(): boolean {
		return this.anchor !== undefined && (this.anchor.row !== this.row || this.anchor.col !== this.col)
	}

	getSelectedText(): string {
		if (this.anchor === undefined) return ""
		const from = this.offsetOf(this.anchor.row, this.anchor.col)
		const to = this.offsetOf(this.row, this.col)
		const [start, end] = from <= to ? [from, to] : [to, from]
		return cpSlice(this.text, start, end)
	}

	deleteSelection(): boolean {
		if (!this.hasSelection) return false
		const anchor = this.anchor!
		const from = this.offsetOf(anchor.row, anchor.col)
		const to = this.offsetOf(this.row, this.col)
		const [start, end] = from <= to ? [from, to] : [to, from]
		this.pushUndo()
		const head = cpSlice(this.text, 0, start)
		const tail = cpSlice(this.text, end)
		this.lines = (head + tail).split("\n")
		this.row = head.split("\n").length - 1
		this.col = cpLength(head.split("\n")[this.row] ?? "")
		this.anchor = undefined
		this.rebaseMarks()
		return true
	}

	// ---------- 撤销 / 重做 ----------

	get canUndo(): boolean {
		return this.undoStack.length > 0
	}

	get canRedo(): boolean {
		return this.redoStack.length > 0
	}

	undo(): boolean {
		const snapshot = this.undoStack.pop()
		if (snapshot === undefined) return false
		this.redoStack.push(this.snapshot())
		this.restore(snapshot)
		return true
	}

	redo(): boolean {
		const snapshot = this.redoStack.pop()
		if (snapshot === undefined) return false
		this.undoStack.push(this.snapshot())
		this.restore(snapshot)
		return true
	}

	// ---------- extmarks ----------

	/** 注册标记类型，返回类型 id（对齐 opentui `extmarks.registerType`）。 */
	registerType(name: string): number {
		const existing = this.markTypes.get(name)
		if (existing !== undefined) return existing
		const id = this.markTypes.size + 1
		this.markTypes.set(name, id)
		return id
	}

	setMark(type: string, start: number, end: number, meta?: unknown): Extmark {
		this.registerType(type)
		const mark: Extmark = { id: this.nextMarkId++, type, start, end, meta }
		this.marks.push(mark)
		return mark
	}

	marksOf(type?: string): readonly Extmark[] {
		return type === undefined ? this.marks : this.marks.filter((mark) => mark.type === type)
	}

	clearMarks(type?: string): void {
		this.marks = type === undefined ? [] : this.marks.filter((mark) => mark.type !== type)
	}

	/** 文本偏移（code point）。 */
	offsetOf(row: number, col: number): number {
		let offset = 0
		for (let i = 0; i < row && i < this.lines.length; i++) offset += cpLength(this.lines[i] ?? "") + 1
		return offset + col
	}

	// ---------- 内部 ----------

	private snapshot(): Snapshot {
		return { lines: [...this.lines], row: this.row, col: this.col }
	}

	private restore(snapshot: Snapshot): void {
		this.lines = [...snapshot.lines]
		this.row = Math.min(snapshot.row, this.lines.length - 1)
		this.col = Math.min(snapshot.col, cpLength(this.lines[this.row] ?? ""))
		this.anchor = undefined
		this.rebaseMarks()
	}

	private pushUndo(): void {
		this.undoStack.push(this.snapshot())
		if (this.undoStack.length > UNDO_LIMIT) this.undoStack.shift()
		this.redoStack = []
	}

	/**
	 * 插入/删除后迁移标记（区间按 [start, end) 语义）：
	 *  - 插入 [p, p+L)：标记整体在 p 之后则平移；跨 p 则延长 end；
	 *    插入点恰在 end 处不延长（end 为开区间）。
	 *  - 删除 [p, p+L)：标记完全在删除区间之后则前移；与删除区间相交则收缩，
	 *    起点落在删除区间内时收敛到 p（不越过删除点）。
	 */
	private shiftMarks(offset: number, length: number, inserted: boolean): void {
		for (const mark of this.marks) {
			if (inserted) {
				if (mark.start >= offset) {
					mark.start += length
					mark.end += length
				} else if (mark.end > offset) {
					mark.end += length
				}
			} else {
				const deleteEnd = offset + length
				if (mark.end <= offset) {
					// 完全在删除点之前，不变
				} else if (mark.start >= deleteEnd) {
					mark.start -= length
					mark.end -= length
				} else {
					const overlapStart = Math.max(mark.start, offset)
					const overlapEnd = Math.min(mark.end, deleteEnd)
					const removed = Math.max(0, overlapEnd - overlapStart)
					mark.end -= removed
					if (mark.start > offset) mark.start = Math.max(offset, mark.start - removed)
				}
			}
			mark.start = Math.max(0, mark.start)
			mark.end = Math.max(mark.start, mark.end)
		}
	}

	/** 全文重建后按比例恢复（简化：仅在 setText/deleteSelection 后清空跨点标记）。 */
	private rebaseMarks(): void {
		const max = cpLength(this.text)
		for (const mark of this.marks) {
			mark.start = Math.min(mark.start, max)
			mark.end = Math.min(Math.max(mark.start, mark.end), max)
		}
	}
}
