import type { CellStyle, Screen } from "../screen"
import { sameStyle } from "../screen"

/**
 * M0 交付：带样式的屏幕快照（对齐 opentui `CapturedFrame`，见
 * node_modules/@opentui/core/types.d.ts:178-193）。
 *
 * 现有 `Screen.snapshot()` 只输出纯文本，样式变化无法断言——而替代计划
 * 的核心验收是"双后端逐格（字符 + fg + bg + 属性 + 宽）全等"，必须先把
 * 样式纳入快照。
 *
 * 与 opentui 的差异（有意为之）：opentui 用 RGBA 对象 + 数值属性位，
 * 这里用 hex 字符串 + 属性名数组。原因：fallback 的 CellStyle 就是 hex
 * 字符串（screen.ts:17-26），跨后端比较由适配层负责把 RGBA 转 hex、
 * 把位掩码转属性名；本模块不引入 @opentui 依赖。
 */

/** 属性名与 CellStyle 字段一一对应（顺序固定，便于快照字符串比较）。 */
export const ATTRIBUTE_ORDER = ["bold", "dim", "italic", "underline", "reverse", "strikethrough"] as const

export type CellAttributeName = (typeof ATTRIBUTE_ORDER)[number]

export interface CapturedSpan {
	/** 段内文本（宽字符占位格不产生字符） */
	readonly text: string
	/** 前景色 hex；未设置时缺省 */
	readonly fg?: string
	/** 背景色 hex；未设置时缺省 */
	readonly bg?: string
	/** 生效的文本属性（有序，无则空数组） */
	readonly attributes: readonly CellAttributeName[]
	/** 显示宽度合计（宽字符按 2 计） */
	readonly width: number
}

export interface CapturedLine {
	readonly spans: readonly CapturedSpan[]
}

export interface CapturedFrame {
	readonly cols: number
	readonly rows: number
	readonly lines: readonly CapturedLine[]
}

function attributesOf(style: CellStyle): CellAttributeName[] {
	const out: CellAttributeName[] = []
	for (const name of ATTRIBUTE_ORDER) {
		if (style[name] === true) out.push(name)
	}
	return out
}

/**
 * 按行把 Cell 网格压成样式段序列。
 *
 * 合并规则：相邻且样式全等的单元格并入同一段（样式全等判定复用
 * `sameStyle`，与 diff 引擎同口径，避免"快照认为同段、差分认为异格"）。
 * 宽字符占位格（width=0）跳过——字形已由主格承载，否则会凭空多出空串段。
 */
export function captureSpans(screen: Screen): CapturedFrame {
	const lines: CapturedLine[] = []
	for (let y = 0; y < screen.height; y++) {
		const spans: CapturedSpan[] = []
		let text = ""
		let width = 0
		let style: CellStyle | undefined
		const flush = () => {
			if (style === undefined) return
			spans.push({ text, fg: style.fg, bg: style.bg, attributes: attributesOf(style), width })
			text = ""
			width = 0
		}
		for (let x = 0; x < screen.width; x++) {
			const cell = screen.cellAt(x, y)
			if (cell.width === 0) continue
			if (style !== undefined && sameStyle(style, cell.style)) {
				text += cell.ch
				width += cell.width
				continue
			}
			flush()
			style = cell.style
			text = cell.ch
			width = cell.width
		}
		flush()
		lines.push({ spans })
	}
	return { cols: screen.width, rows: screen.height, lines }
}

/** 快照转可读文本行（断言失败时打印用；宽字符占位格不重复输出）。 */
export function captureLines(frame: CapturedFrame): string[] {
	return frame.lines.map((line) => line.spans.map((span) => span.text).join(""))
}
