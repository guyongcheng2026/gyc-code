import type { Cell, CellStyle } from "./screen"
import { cellEqual, Screen, sameStyle } from "./screen"

/**
 * 自研 fallback 渲染器：差分帧引擎。
 *
 * 策略：逐行扫描变化区间（first..last 整段重绘），段内按样式连续子段
 * 切换 SGR，最小化转义字节输出。宽字符占位格（width=0）归属主格，
 * 重绘区间自动扩展，保证宽字符不被撕裂。
 */

const RESET = "\x1b[0m"

function sgrFor(style: CellStyle): string {
	const codes: string[] = []
	if (style.bold) codes.push("1")
	if (style.dim) codes.push("2")
	if (style.italic) codes.push("3")
	if (style.underline) codes.push("4")
	if (style.reverse) codes.push("7")
	if (style.strikethrough) codes.push("9")
	if (style.fg) codes.push(fgCode(style.fg))
	if (style.bg) codes.push(bgCode(style.bg))
	if (codes.length === 0) return RESET
	return `\x1b[${codes.join(";")}m`
}

function parseHex(color: string): [number, number, number] {
	const hex = color.replace("#", "")
	const full = hex.length === 3 ? hex.split("").map((c) => c + c).join("") : hex
	const n = Number.parseInt(full.slice(0, 6), 16)
	return [(n >> 16) & 0xff, (n >> 8) & 0xff, n & 0xff]
}

function fgCode(color: string): string {
	const [r, g, b] = parseHex(color)
	return `38;2;${r};${g};${b}`
}

function bgCode(color: string): string {
	const [r, g, b] = parseHex(color)
	return `48;2;${r};${g};${b}`
}

/** 进入全屏模式序列：alt-screen + 清屏 + 隐藏光标 */
export const ENTER_SEQ = "\x1b[?1049h\x1b[H\x1b[2J\x1b[?25l"
/** 离开全屏模式序列：显示光标 + 恢复主屏 */
export const LEAVE_SEQ = "\x1b[?25h\x1b[?1049l"

/**
 * 计算增量帧：仅重绘内容发生变化的行。
 * 返回空串表示两帧完全一致。
 *
 * slice B 性能优化：行写戳短路——两屏同 y 行戳相等（该行未发生任何
 * 实际写入）时 O(1) 跳过，免除逐格比较；戳不等时再逐格浅比较定位
 * 区间（cellEqual，无字符串构造）。
 */
export function renderDelta(prev: Screen, next: Screen): string {
	if (prev.width !== next.width || prev.height !== next.height) {
		return renderFull(next)
	}
	let out = ""
	for (let y = 0; y < next.height; y++) {
		if (prev.rowStampAt(y) === next.rowStampAt(y)) continue
		out += renderChangedSegment(prev, next, y)
	}
	return out
}

/** 全量绘制（不含进入序列），每行定位后整行写入。 */
export function renderFull(screen: Screen): string {
	let out = ""
	for (let y = 0; y < screen.height; y++) {
		out += renderRow(screen, y)
	}
	return out
}

function renderRow(screen: Screen, y: number): string {
	let out = `\x1b[${y + 1};1H`
	let cur: CellStyle | undefined
	for (let x = 0; x < screen.width; x++) {
		const cell = screen.cellAt(x, y)
		if (cell.width === 0) continue
		if (cur === undefined || !sameStyle(cur, cell.style)) {
			out += sgrFor(cell.style)
			cur = cell.style
		}
		out += cell.ch
	}
	out += RESET
	return out
}

/**
 * 重绘某行的变化区间 [first..last]，边界向外扩展吞并宽字符占位格，
 * 区间内按连续同样式子段切换 SGR。浅比较定位（无字符串构造）。
 */
function renderChangedSegment(prev: Screen, next: Screen, y: number): string {
	let first = -1
	let last = -1
	for (let x = 0; x < next.width; x++) {
		if (!cellEqual(prev.cellAt(x, y), next.cellAt(x, y))) {
			if (first < 0) first = x
			last = x
		}
	}
	if (first < 0) return ""
	while (first > 0 && next.cellAt(first, y).width === 0) first -= 1
	while (last + 1 < next.width && next.cellAt(last + 1, y).width === 0) last += 1

	let out = `\x1b[${y + 1};${first + 1}H`
	let cur: CellStyle | undefined
	for (let x = first; x <= last; x++) {
		const cell = next.cellAt(x, y)
		if (cell.width === 0) continue
		if (cur === undefined || !sameStyle(cur, cell.style)) {
			out += sgrFor(cell.style)
			cur = cell.style
		}
		out += cell.ch
		x += cell.width - 1
	}
	out += RESET
	return out
}
