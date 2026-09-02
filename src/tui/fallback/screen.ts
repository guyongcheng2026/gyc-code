import { charWidth } from "./char-width"
import { renderScreenToLines } from "./snapshot.js"

/**
 * 自研 fallback 渲染器：Cell 网格模型。
 *
 * 定位：opentui 失效（FFI/DLL 加载失败、原生崩溃）时的安全模式保底，
 * 以及全面替换决策的技术孵化载体。宽度口径与 src/core/util/display-width.ts
 * 同源（string-width），从根上杜绝原生/JS 宽度判定分歧导致的乱码。
 *
 * 富文本样式层（P1 扩容，2026-08-26）：CellStyle 全字段对齐 opentui
 * StyleDefinition；tree-sitter token 样式解析见 rich-text.ts。
 *
 * 明确不做：布局引擎、Solid reconciler、鼠标。超纲即砍。
 */

export interface CellStyle {
	readonly fg?: string
	readonly bg?: string
	readonly bold?: boolean
	readonly dim?: boolean
	readonly reverse?: boolean
	readonly italic?: boolean
	readonly underline?: boolean
	readonly strikethrough?: boolean
}

export interface Cell {
	/** 显示字符；宽字符占位格为空串 */
	readonly ch: string
	/** 显示宽度：1 = 半角，2 = 宽字符主格，0 = 宽字符占位格 */
	readonly width: 0 | 1 | 2
	readonly style: CellStyle
}

const BLANK_STYLE: CellStyle = {}
const BLANK: Cell = { ch: " ", width: 1, style: BLANK_STYLE }

/** 样式浅比较（全字段；diff 引擎与本类值比较写入共用）。 */
export function sameStyle(a: CellStyle, b: CellStyle): boolean {
	return (
		a.fg === b.fg &&
		a.bg === b.bg &&
		a.bold === b.bold &&
		a.dim === b.dim &&
		a.reverse === b.reverse &&
		a.italic === b.italic &&
		a.underline === b.underline &&
		a.strikethrough === b.strikethrough
	)
}

/** 单元格相等（字符/宽度/样式全比较；值比较写入与差分定位共用）。 */
export function cellEqual(a: Cell, b: Cell): boolean {
	return a.ch === b.ch && a.width === b.width && sameStyle(a.style, b.style)
}

/** 行戳全局计数器（单调递增；跨 Screen 实例共享，保证不同写入产生不同戳）。 */
let stampCounter = 0

export class Screen {
	private cells: Cell[]
	private cols: number
	private rows: number
	/**
	 * 行级写戳：slice B 性能优化——renderDelta 先比戳跳过未变行（O(1)/行）。
	 * Float64Array：计数器是 JS number，存 Uint32Array 会在 2^32 写入后
	 * 截断回绕、可能恰好撞上旧戳误判"未变"而漏重绘（防御性精度）。
	 */
	private rowStamps: Float64Array
	private dirtyRows: Uint8Array

	constructor(cols: number, rows: number) {
		this.cols = Math.max(1, Math.floor(cols))
		this.rows = Math.max(1, Math.floor(rows))
		this.cells = Array.from({ length: this.cols * this.rows }, () => BLANK)
		this.rowStamps = new Float64Array(this.rows)
		this.dirtyRows = new Uint8Array(this.rows)
	}

	/** 行脏标记：标记指定行已被修改。 */
	markRowDirty(y: number): void {
		if (y >= 0 && y < this.rows) {
			this.dirtyRows[y] = 1
		}
	}

	/** 单元格脏标记：标记单元格所在的行已被修改。 */
	markCellDirty(x: number, y: number): void {
		if (y >= 0 && y < this.rows) {
			this.dirtyRows[y] = 1
		}
	}

	/** 获取脏行掩码。 */
	dirtyRowMask(): Uint8Array {
		return this.dirtyRows
	}

	/** 重置所有脏标志。 */
	resetDirty(): void {
		this.dirtyRows.fill(0)
	}

	/** 行写戳（差分引擎短路判定用）。 */
	rowStampAt(y: number): number {
		if (y < 0 || y >= this.rows) return -1
		return this.rowStamps[y]!
	}

	/** 同步另一屏的行戳（内容已证等价时的零拷贝对齐，见 terminal.present）。 */
	syncStampsFrom(other: Screen): void {
		if (this.rows !== other.rows) return
		this.rowStamps.set(other.rowStamps)
	}

	get width(): number {
		return this.cols
	}

	get height(): number {
		return this.rows
	}

	cellAt(x: number, y: number): Cell {
		if (x < 0 || x >= this.cols || y < 0 || y >= this.rows) return BLANK
		return this.cells[y * this.cols + x]!
	}

	clear(): void {
		this.cells.fill(BLANK)
		// 清屏视为全行写入：未变化行由后续重写的值比较吸收（戳不递增），
		// 原本非空的行戳递增（BLANK 与原值不等）
		for (let y = 0; y < this.rows; y++) {
			this.rowStamps[y] = ++stampCounter
		}
		this.dirtyRows.fill(0)
	}

	/**
	 * 调整尺寸：保留左上角重叠区域内容，新增区域置空。
	 * 返回 true 表示尺寸实际发生变化。
	 */
	resize(cols: number, rows: number): boolean {
		const nc = Math.max(1, Math.floor(cols))
		const nr = Math.max(1, Math.floor(rows))
		if (nc === this.cols && nr === this.rows) return false
		const next = Array.from({ length: nc * nr }, () => BLANK)
		const copyCols = Math.min(this.cols, nc)
		const copyRows = Math.min(this.rows, nr)
		for (let y = 0; y < copyRows; y++) {
			for (let x = 0; x < copyCols; x++) {
				next[y * nc + x] = this.cells[y * this.cols + x]!
			}
		}
		this.cells = next
		this.cols = nc
		this.rows = nr
		// 保留重叠区行戳（防御性：当前调用方 resize 后总伴随全量重绘，
		// 但若未来走 delta 路径，全 0 戳会误判旧行未变而漏重绘）
		const prevStamps = this.rowStamps
		this.rowStamps = new Float64Array(nr)
		this.rowStamps.set(prevStamps.subarray(0, Math.min(nr, prevStamps.length)))
		this.dirtyRows = new Uint8Array(nr)
		return true
	}

	fillRect(x: number, y: number, w: number, h: number, style: CellStyle): void {
		for (let ry = y; ry < y + h && ry < this.rows; ry++) {
			for (let rx = x; rx < x + w && rx < this.cols; rx++) {
				if (rx < 0 || ry < 0) continue
				this.setCell(rx, ry, { ch: " ", width: 1, style })
			}
		}
	}

	/**
	 * 在 (x, y) 写入单行文本（不换行），返回终止列号（下一可写位置）。
	 * 控制字符被替换为空格；宽字符在行尾放不下时停止写入。
	 */
	writeText(x: number, y: number, text: string, style: CellStyle = BLANK_STYLE): number {
		if (y < 0 || y >= this.rows) return x
		let cx = Math.max(0, x)
		for (const ch of text) {
			const code = ch.codePointAt(0) ?? 0
			// 控制字符（含 CR/LF/TAB）不入网格
			if (code < 0x20 || code === 0x7f) {
				this.setCell(cx, y, { ch: " ", width: 1, style })
				cx += 1
				continue
			}
			const w = charWidth(ch)
			const width = w === 2 ? 2 : 1
			if (cx + width > this.cols) break
			this.setCell(cx, y, { ch, width, style })
			cx += 1
			if (width === 2) {
				this.setCell(cx, y, { ch: "", width: 0, style })
				cx += 1
			}
		}
		return cx
	}

	private setCell(x: number, y: number, cell: Cell): void {
		if (x < 0 || x >= this.cols || y < 0 || y >= this.rows) return
		const idx = y * this.cols + x
		// 值比较写入：内容未变不写不递增戳（全量重绘场景下吸收无效写入）
		if (cellEqual(this.cells[idx]!, cell)) return
		this.cells[idx] = cell
		this.rowStamps[y] = ++stampCounter
		this.markCellDirty(x, y)
	}

	/** 深拷贝当前网格（含行写戳——快照的戳反映该时刻状态）。 */
	clone(): Screen {
		const copy = new Screen(this.cols, this.rows)
		copy.cells = this.cells.map((c) => ({ ...c }))
		copy.rowStamps = this.rowStamps.slice()
		copy.dirtyRows = this.dirtyRows.slice()
		return copy
	}

	/**
	 * 双缓冲：将当前屏幕内容复制到目标屏幕，避免深拷贝。
	 * 使用数组引用交换+清空的方式，比 clone() 的 map/slice 更高效。
	 * 返回 true 表示尺寸一致可复制，false 表示尺寸不匹配需 fallback 到 clone。
	 */
	swapTo(target: Screen): boolean {
		if (this.cols !== target.cols || this.rows !== target.rows) return false
		// 交换 cells 数组引用
		const tmpCells = target.cells
		target.cells = this.cells
		this.cells = tmpCells
		// 交换 rowStamps
		const tmpStamps = target.rowStamps
		target.rowStamps = this.rowStamps
		this.rowStamps = tmpStamps
		// 清空当前屏幕（供下一帧写入）
		this.cells.fill(BLANK)
		for (let y = 0; y < this.rows; y++) {
			this.rowStamps[y] = ++stampCounter
		}
		this.dirtyRows.fill(0)
		return true
	}

	/**
	 * 双缓冲快照：将当前屏幕内容保存到 prevScreen，供下一帧 delta 比较。
	 * 与 clone() 不同，此方法使用数组引用交换，避免深拷贝开销。
	 * 注意：此方法不会清空当前屏幕，当前屏幕保留内容供后续使用。
	 */
	snapshotTo(prevScreen: Screen): void {
		if (this.cols !== prevScreen.cols || this.rows !== prevScreen.rows) {
			// 尺寸不匹配，fallback 到深拷贝
			prevScreen.cells = this.cells.map((c) => ({ ...c }))
			prevScreen.rowStamps = this.rowStamps.slice()
			prevScreen.cols = this.cols
			prevScreen.rows = this.rows
			return
		}
		// 复制 cells 内容（不交换引用，保留当前屏幕）
		for (let i = 0; i < this.cells.length; i++) {
			prevScreen.cells[i] = this.cells[i]!
		}
		// 复制 rowStamps
		prevScreen.rowStamps.set(this.rowStamps)
		// 复制 dirtyRows
		prevScreen.dirtyRows.set(this.dirtyRows)
	}

	/** 每行拼接为纯文本，供快照断言。宽字符占位格输出空串。委托 snapshot.ts 纯函数。*/
	snapshot(): string[] {
		return renderScreenToLines(this)
	}
}
