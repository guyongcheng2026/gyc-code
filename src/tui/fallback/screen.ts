import stringWidth from "string-width"
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

	constructor(cols: number, rows: number) {
		this.cols = Math.max(1, Math.floor(cols))
		this.rows = Math.max(1, Math.floor(rows))
		this.cells = Array.from({ length: this.cols * this.rows }, () => BLANK)
		this.rowStamps = new Float64Array(this.rows)
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
			const w = stringWidth(ch) as 0 | 1 | 2
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
	}

	/** 深拷贝当前网格（含行写戳——快照的戳反映该时刻状态）。 */
	clone(): Screen {
		const copy = new Screen(this.cols, this.rows)
		copy.cells = this.cells.map((c) => ({ ...c }))
		copy.rowStamps = this.rowStamps.slice()
		return copy
	}

	/** 每行拼接为纯文本，供快照断言。宽字符占位格输出空串。委托 snapshot.ts 纯函数。*/
	snapshot(): string[] {
		return renderScreenToLines(this)
	}
}
