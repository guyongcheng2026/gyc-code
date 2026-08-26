import stringWidth from "string-width"
import type { CellStyle, Screen } from "../screen"
import type { ElementNode, FallbackNode, LayoutRect } from "./nodes"

/**
 * S1 组件桥接：布局计算与网格绘制。
 *
 * 布局模型（parity slice A 增强）：
 * - 显式 width/height 优先；width 缺省继承父宽；height 缺省按内容自适应。
 * - flex=true 在父级对应轴有界时瓜分剩余空间（平分）。
 * - direction="column"（默认）：子元素纵向堆叠；"row"：横向排列
 *   （宽度按内容自然宽，高度默认拉伸到父内容高）。
 * - border（box 专属）：绘制框线，内容区内缩 1 格。
 * - padding：内容内缩；gap：子元素间距（沿主轴）。
 * - text 内容按显示宽度 wrap（与 Screen.writeWidth 同口径）；
 *   spans 富文本行同样 wrap（按 span 段折行）。
 *
 * 绘制模型：全量重绘 Screen，字节级增量由 FallbackRenderer 差分引擎负责。
 * scrollbox 用 clip 矩形 + 垂直偏移裁剪子内容。
 */

/** 富文本行内段（Markdown/富文本渲染的原子单位）。 */
export interface StyledSpan {
	readonly text: string
	readonly style: CellStyle
}

const charWidth = (ch: string): number => (stringWidth(ch) === 2 ? 2 : 1)

export function textDisplayWidth(text: string): number {
	let w = 0
	for (const ch of text) w += charWidth(ch)
	return w
}

/** 按显示宽度把单行文本 wrap 成多行（与 screen.writeText 口径一致：零宽按 1）。 */
export function wrapText(text: string, width: number): string[] {
	if (width <= 0) return [""]
	const lines: string[] = []
	let current = ""
	let currentWidth = 0
	for (const ch of text) {
		if (ch === "\n") {
			lines.push(current)
			current = ""
			currentWidth = 0
			continue
		}
		const w = charWidth(ch)
		if (currentWidth + w > width) {
			lines.push(current)
			current = ch
			currentWidth = w
			continue
		}
		current += ch
		currentWidth += w
	}
	lines.push(current)
	return lines
}

/** 富文本 spans wrap：按显示宽度折行，返回每行的段列表（相邻同段合并由调用方决定）。 */
export function wrapSpans(spans: readonly StyledSpan[], width: number): StyledSpan[][] {
	if (width <= 0) return [[]]
	const rows: StyledSpan[][] = []
	let current: StyledSpan[] = []
	let currentWidth = 0
	const flush = () => {
		rows.push(current)
		current = []
		currentWidth = 0
	}
	for (const span of spans) {
		for (const ch of span.text) {
			const w = charWidth(ch)
			if (currentWidth + w > width) flush()
			// 行尾已有同样式段则续接，否则新开段
			const last = current[current.length - 1]
			if (last !== undefined && last.style === span.style) {
				current[current.length - 1] = { text: last.text + ch, style: span.style }
			} else {
				current.push({ text: ch, style: span.style })
			}
			currentWidth += w
		}
	}
	flush()
	return rows
}

function styleOf(el: ElementNode): CellStyle | undefined {
	const style = el.props.style
	return typeof style === "object" && style !== null ? (style as CellStyle) : undefined
}

function isFlex(node: FallbackNode): boolean {
	return node.kind === "element" && node.props.flex === true
}

function directionOf(el: ElementNode): "row" | "column" {
	return el.props.direction === "row" ? "row" : "column"
}

function paddingOf(el: ElementNode): number {
	const p = el.props.padding
	return typeof p === "number" ? Math.max(0, Math.floor(p)) : 0
}

function gapOf(el: ElementNode): number {
	const g = el.props.gap
	return typeof g === "number" ? Math.max(0, Math.floor(g)) : 0
}

const BORDER_GLYPHS = {
	single: { tl: "┌", tr: "┐", bl: "└", br: "┘", h: "─", v: "│" },
	double: { tl: "╔", tr: "╗", bl: "╚", br: "╝", h: "═", v: "║" },
} as const

export type BorderKind = "single" | "double"

function borderOf(el: ElementNode): BorderKind | undefined {
	const b = el.props.border
	if (b === "single" || b === "double") return b
	if (b === true) return "single"
	return undefined
}

/** border+padding 之后的内缩量 {x 偏移, 总宽减量}。 */
function insetOf(el: ElementNode): { dx: number; dw: number } {
	const border = borderOf(el) !== undefined ? 1 : 0
	const padding = paddingOf(el)
	const dx = border + padding
	return { dx, dw: 2 * dx }
}

/** 元素的内容矩形（border/padding 内缩后）。 */
function contentRect(el: ElementNode): LayoutRect {
	const { dx } = insetOf(el)
	const l = el.layout
	return { x: l.x + dx, y: l.y + dx, width: Math.max(0, l.width - 2 * dx), height: Math.max(0, l.height - 2 * dx) }
}

// ---- 量算 ----

function spansOf(el: ElementNode): StyledSpan[] | undefined {
	const spans = el.props.spans
	if (!Array.isArray(spans)) return undefined
	const out: StyledSpan[] = []
	for (const s of spans) {
		if (typeof s === "object" && s !== null && typeof (s as StyledSpan).text === "string") {
			out.push({ text: (s as StyledSpan).text, style: (s as StyledSpan).style ?? {} })
		}
	}
	return out
}

/** 节点在给定宽度下的内容高度（行数）。显式 height 优先于内容量算。 */
function measureNode(node: FallbackNode, width: number): number {
	if (node.kind === "text") return wrapText(node.text, width).length
	const el = node
	if (typeof el.props.height === "number") return el.props.height
	if (el.type === "textarea") return measureTextarea(el, width)
	if (el.type === "scrollbox") return measureChildren(el, width)
	if (el.type === "text") {
		const spans = spansOf(el)
		if (spans !== undefined) return wrapSpans(spans, width).length
		const content = collectText(el)
		return wrapText(content, width).length
	}
	// box：子元素堆叠高度（row 取子高最大值）
	return measureChildren(el, width)
}

function measureChildren(el: ElementNode, width: number): number {
	const content = contentRectOf(el, width)
	const gap = gapOf(el)
	if (directionOf(el) === "row") {
		let max = 0
		let visible = 0
		for (const child of el.children) {
			if (isFlex(child)) continue
			max = Math.max(max, measureNode(child, content.width))
			visible += 1
		}
		const inset = insetOf(el)
		return max + inset.dw + (visible > 1 ? gap * (visible - 1) : 0)
	}
	let total = 0
	for (const child of el.children) {
		if (isFlex(child)) continue // flex 子高度由布局阶段分配，量算不计
		total += measureNode(child, content.width)
	}
	const inset = insetOf(el)
	return total + inset.dw + (el.children.length > 1 ? gap * (el.children.length - 1) : 0)
}

/** 量算辅助：el 尚无布局时按给定宽度构造内容矩形（border/padding 已内缩）。 */
function contentRectOf(el: ElementNode, width: number): LayoutRect {
	const { dw } = insetOf(el)
	return { x: 0, y: 0, width: Math.max(0, width - dw), height: Number.POSITIVE_INFINITY }
}

/** 节点的内容自然宽度（row 布局用；text 不 wrap 取整行宽）。 */
function measureNaturalWidth(node: FallbackNode): number {
	if (node.kind === "text") return textDisplayWidth(node.text)
	const el = node
	const inset = insetOf(el)
	if (typeof el.props.width === "number") return el.props.width
	if (el.type === "textarea") {
		return textareaLines(el).reduce((m, l) => Math.max(m, textDisplayWidth(l)), 0) + inset.dw
	}
	if (el.type === "text") {
		const spans = spansOf(el)
		if (spans !== undefined) return spans.reduce((m, s) => m + textDisplayWidth(s.text), 0) + inset.dw
		return textDisplayWidth(collectText(el)) + inset.dw
	}
	const gap = gapOf(el)
	if (directionOf(el) === "row") {
		let sum = 0
		for (const child of el.children) {
			if (isFlex(child)) continue
			sum += measureNaturalWidth(child)
		}
		return sum + inset.dw + (el.children.length > 1 ? gap * (el.children.length - 1) : 0)
	}
	let max = 0
	for (const child of el.children) {
		if (isFlex(child)) continue
		max = Math.max(max, measureNaturalWidth(child))
	}
	return max + inset.dw
}

function measureTextarea(el: ElementNode, width: number): number {
	const lines = textareaLines(el)
	return wrapTextareaLines(lines, width).length
}

function textareaLines(el: ElementNode): string[] {
	const lines = el.props.lines
	if (Array.isArray(lines)) return lines.filter((l): l is string => typeof l === "string")
	return []
}

// ---- 布局 ----

export interface TextareaDisplayRow {
	readonly text: string
	readonly logicRow: number
	readonly colStart: number
}

export function wrapTextareaLines(lines: readonly string[], width: number): TextareaDisplayRow[] {
	const rows: TextareaDisplayRow[] = []
	if (width <= 0) return rows
	lines.forEach((line, logicRow) => {
		const wrapped = wrapText(line, width)
		if (wrapped.length === 0 || (wrapped.length === 1 && wrapped[0] === "")) {
			rows.push({ text: "", logicRow, colStart: 0 })
			return
		}
		let colStart = 0
		for (const seg of wrapped) {
			rows.push({ text: seg, logicRow, colStart })
			// colStart 必须按 code point 累计（cursorCol 口径），
			// UTF-16 length 会让代理对（emoji）后的换行行首映射错位
			colStart += Array.from(seg).length
		}
	})
	return rows
}

/** 自顶向下布局：root 占满屏幕。 */
export function layoutTree(root: ElementNode, width: number, height: number): void {
	layoutElement(root, 0, 0, width, height)
}

function layoutElement(el: ElementNode, x: number, y: number, width: number, height: number): void {
	el.layout = { x, y, width, height }
	if (el.type === "textarea") {
		el.contentHeight = measureTextarea(el, width)
		return
	}
	if (el.type === "scrollbox") {
		// 子内容布局在虚拟全高（可超出视口），绘制阶段按 scrollTop 裁剪
		el.contentHeight = measureChildren(el, width)
		const requested = typeof el.props.scrollTop === "number" ? el.props.scrollTop : 0
		const maxScroll = Math.max(0, el.contentHeight - height)
		el.scrollTop = Math.min(Math.max(0, requested), maxScroll)
		layoutChildren(el, el.contentHeight)
		return
	}
	if (el.type === "text") {
		const spans = spansOf(el)
		if (spans !== undefined) {
			el.contentHeight = wrapSpans(spans, width).length
			return
		}
		const content = collectText(el)
		el.contentHeight = wrapText(content, width).length
		return
	}
	// box：布局子元素（两遍法：先量非 flex，再分配）
	el.contentHeight = layoutChildren(el, height)
}

/** 布局子元素并返回内容总高度。height 为父级给定的有界高度。 */
function layoutChildren(el: ElementNode, height: number): number {
	const content = contentRect(el)
	const gap = gapOf(el)
	const kids = el.children
	if (directionOf(el) === "row") {
		return layoutRowChildren(el, content, height, gap)
	}
	const heights: Array<number | undefined> = kids.map((child) =>
		isFlex(child) ? undefined : measureNode(child, content.width),
	)
	const fixedSum = heights.reduce<number>((acc, h) => acc + (h ?? 0), 0)
	const flexCount = kids.filter(isFlex).length
	const gaps = kids.length > 1 ? gap * (kids.length - 1) : 0
	let flexHeight = 0
	if (flexCount > 0 && Number.isFinite(height)) {
		flexHeight = Math.max(0, Math.floor((height - fixedSum - gaps) / flexCount))
	}
	let childY = content.y
	kids.forEach((child, index) => {
		const childHeight = heights[index] ?? flexHeight
		if (child.kind === "text") {
			child.layout = { x: content.x, y: childY, width: content.width, height: childHeight }
			childY += childHeight + gap
			return
		}
		layoutElement(child, content.x, childY, content.width, childHeight)
		childY += childHeight + gap
	})
	// 末尾 gap 不计入总高
	return childY - content.y - (kids.length > 0 ? gap : 0)
}

/** row 布局：子元素横向排列，宽度按自然宽/flex 瓜分，高度默认拉伸到内容高。 */
function layoutRowChildren(el: ElementNode, content: LayoutRect, _height: number, gap: number): number {
	const kids = el.children
	const widths: Array<number | undefined> = kids.map((child) =>
		isFlex(child) ? undefined : measureNaturalWidth(child),
	)
	const fixedSum = widths.reduce<number>((acc, w) => acc + (w ?? 0), 0)
	const flexCount = kids.filter(isFlex).length
	const gaps = kids.length > 1 ? gap * (kids.length - 1) : 0
	let flexWidth = 0
	if (flexCount > 0 && Number.isFinite(content.width)) {
		flexWidth = Math.max(0, Math.floor((content.width - fixedSum - gaps) / flexCount))
	}
	let childX = content.x
	let maxChildHeight = 0
	kids.forEach((child, index) => {
		const childWidth = widths[index] ?? flexWidth
		// 高度：显式 height 优先，缺省拉伸到父内容高
		const explicit = child.kind === "element" && typeof child.props.height === "number" ? child.props.height : undefined
		const childHeight = explicit ?? Math.max(0, content.height)
		if (child.kind === "text") {
			child.layout = { x: childX, y: content.y, width: childWidth, height: childHeight }
		} else {
			layoutElement(child, childX, content.y, childWidth, childHeight)
		}
		maxChildHeight = Math.max(maxChildHeight, childHeight)
		childX += childWidth + gap
	})
	return maxChildHeight
}

/** 收集元素内联文本（textnode 子节点）。 */
function collectText(el: ElementNode): string {
	let out = ""
	for (const child of el.children) {
		if (child.kind === "text") out += child.text
	}
	return out
}

// ---- 绘制 ----

export function paintTree(root: ElementNode, screen: Screen): void {
	const clip: LayoutRect = { x: 0, y: 0, width: screen.width, height: screen.height }
	paintNode(root, screen, clip, 0)
}

/** 沿祖先链继承样式（有限深度；text 无自身 style 时取最近有 style 的祖先）。 */
function inheritStyle(el: ElementNode): CellStyle | undefined {
	let cur: FallbackNode | undefined = el
	for (let depth = 0; depth < 8 && cur !== undefined; depth += 1) {
		if (cur.kind === "element") {
			const s = styleOf(cur)
			if (s !== undefined) return s
		}
		cur = cur.parent
	}
	return undefined
}

function paintNode(node: FallbackNode, screen: Screen, clip: LayoutRect, offsetY: number): void {
	if (node.kind === "text") {
		paintTextLines(node.text, node.layout, styleFromParent(node.parent), screen, clip, offsetY)
		return
	}
	const el = node
	switch (el.type) {
		case "textarea":
			paintTextarea(el, screen, clip)
			return
		case "scrollbox":
			// 视口裁剪：内容必须限制在 scrollbox 自身矩形内，
			// 否则超出视口的内容会溢出绘制到后续兄弟元素（状态条/输入区）
			paintChildren(el, screen, intersect(clip, el.layout), -el.scrollTop)
			return
		case "text": {
			const spans = spansOf(el)
			const base = styleOf(el) ?? inheritStyle(el)
			if (spans !== undefined) {
				paintSpanLines(spans, el.layout, base, screen, clip, offsetY)
				return
			}
			const content = collectText(el)
			paintTextLines(content, el.layout, base, screen, clip, offsetY)
			return
		}
		default:
			paintBox(el, screen, clip, offsetY)
	}
}

function styleFromParent(parent: FallbackNode | undefined): CellStyle | undefined {
	if (parent === undefined || parent.kind !== "element") return undefined
	return styleOf(parent)
}

function paintBox(el: ElementNode, screen: Screen, clip: LayoutRect, offsetY: number): void {
	const style = styleOf(el)
	const bg = style?.bg
	if (bg !== undefined) {
		fillClipped(el.layout, bg, screen, clip, offsetY)
	}
	const border = borderOf(el)
	if (border !== undefined) {
		paintBorder(el, border, screen, clip, offsetY)
	}
	// 内容裁剪到 border+padding 内缩矩形
	paintChildren(el, screen, intersect(clip, contentRect(el)), offsetY)
}

function paintBorder(el: ElementNode, kind: BorderKind, screen: Screen, clip: LayoutRect, offsetY: number): void {
	const g = BORDER_GLYPHS[kind]
	const { x, y, width, height } = el.layout
	const style = styleOf(el) ?? {}
	const put = (cx: number, cy: number, ch: string) => {
		const yy = cy + offsetY
		if (yy < clip.y || yy >= clip.y + clip.height) return
		if (cx < clip.x || cx >= clip.x + clip.width) return
		screen.writeText(cx, yy, ch, style)
	}
	// 顶边（含角）与底边
	for (let i = 0; i < width; i++) {
		put(x + i, y, i === 0 ? g.tl : i === width - 1 ? g.tr : g.h)
		if (height > 1) put(x + i, y + height - 1, i === 0 ? g.bl : i === width - 1 ? g.br : g.h)
	}
	// 侧边
	for (let j = 1; j < height - 1; j++) {
		put(x, y + j, g.v)
		if (width > 1) put(x + width - 1, y + j, g.v)
	}
}

function paintChildren(el: ElementNode, screen: Screen, clip: LayoutRect, offsetY: number): void {
	for (const child of el.children) paintNode(child, screen, clip, offsetY)
}

function fillClipped(rect: LayoutRect, bg: string, screen: Screen, clip: LayoutRect, offsetY: number): void {
	const y0 = Math.max(rect.y + offsetY, clip.y)
	const y1 = Math.min(rect.y + rect.height + offsetY, clip.y + clip.height)
	const x0 = Math.max(rect.x, clip.x)
	const x1 = Math.min(rect.x + rect.width, clip.x + clip.width)
	for (let y = y0; y < y1; y++) {
		for (let x = x0; x < x1; x++) {
			screen.writeText(x, y, " ", { bg })
		}
	}
}

function paintTextLines(
	text: string,
	rect: LayoutRect,
	style: CellStyle | undefined,
	screen: Screen,
	clip: LayoutRect,
	offsetY: number,
): void {
	const lines = wrapText(text, rect.width)
	lines.forEach((line, index) => {
		const y = rect.y + index + offsetY
		if (y < clip.y || y >= clip.y + clip.height) return
		// 裁剪列范围：从 clip.x 起的可见前缀
		const visibleWidth = Math.min(rect.width, clip.x + clip.width - rect.x)
		if (visibleWidth <= 0) return
		const visible = clipLine(line, visibleWidth)
		if (visible.length > 0) screen.writeText(rect.x, y, visible, style ?? {})
	})
}

/** 富文本行绘制：spans wrap 后逐段写入（段样式 = base 与 span.style 合并）。 */
function paintSpanLines(
	spans: readonly StyledSpan[],
	rect: LayoutRect,
	base: CellStyle | undefined,
	screen: Screen,
	clip: LayoutRect,
	offsetY: number,
): void {
	const rows = wrapSpans(spans, rect.width)
	rows.forEach((row, index) => {
		const y = rect.y + index + offsetY
		if (y < clip.y || y >= clip.y + clip.height) return
		let cx = rect.x
		for (const span of row) {
			const visibleWidth = Math.min(rect.width - (cx - rect.x), clip.x + clip.width - cx)
			if (visibleWidth <= 0) break
			const visible = clipLine(span.text, visibleWidth)
			if (visible.length > 0) {
				screen.writeText(cx, y, visible, { ...(base ?? {}), ...span.style })
			}
			cx += textDisplayWidth(visible)
		}
	})
}

/** 截取行的可见前缀（按显示宽度）。 */
function clipLine(line: string, maxWidth: number): string {
	if (maxWidth <= 0) return ""
	let w = 0
	let out = ""
	for (const ch of line) {
		const cw = charWidth(ch)
		if (w + cw > maxWidth) break
		out += ch
		w += cw
	}
	return out
}

function paintTextarea(el: ElementNode, screen: Screen, clip: LayoutRect): void {
	const rect = el.layout
	const innerClip = intersect(clip, rect)
	const lines = textareaLines(el)
	const rows = wrapTextareaLines(lines, rect.width)
	const cursorRow = typeof el.props.cursorRow === "number" ? el.props.cursorRow : 0
	const cursorCol = typeof el.props.cursorCol === "number" ? el.props.cursorCol : 0
	// 光标可见性（S1 slice 2：闪烁支持——visible=false 时跳过反白光标块）
	const cursorVisible = el.props.cursorVisible !== false
	const style = styleOf(el)
	// 光标可见性滚动：光标强制保持在视口内（贴底收敛）
	const cursorPos = cursorDisplayPos(rows, cursorRow, cursorCol)
	const scrollOffset = Math.max(0, Math.min(cursorPos.dispRow - rect.height + 1, Math.max(0, rows.length - rect.height)))
	rows.forEach((row, index) => {
		const y = rect.y + index - scrollOffset
		if (y < innerClip.y || y >= innerClip.y + innerClip.height) return
		screen.writeText(rect.x, y, clipLine(row.text, rect.width), style ?? {})
	})
	// 光标反白（cursorVisible=false 时隐藏——闪烁的"灭"相位）
	if (cursorVisible) {
		const cursorY = rect.y + cursorPos.dispRow - scrollOffset
		if (cursorY >= innerClip.y && cursorY < innerClip.y + innerClip.height) {
			const cursorLine = rows[cursorPos.dispRow]?.text ?? ""
			// code point 切片：UTF-16 slice 会把代理对劈成两半（乱码格）
			const cps = Array.from(cursorLine)
			const prefix = cps.slice(0, cursorPos.dispCol).join("")
			const x = rect.x + textDisplayWidth(prefix)
			const ch = cps[cursorPos.dispCol] ?? " "
			if (x < innerClip.x + innerClip.width) {
				screen.writeText(x, cursorY, ch, { ...(style ?? {}), reverse: true })
			}
		}
	}
}

export function cursorDisplayPos(
	rows: readonly TextareaDisplayRow[],
	cursorRow: number,
	cursorCol: number,
): { dispRow: number; dispCol: number } {
	for (let i = 0; i < rows.length; i++) {
		const row = rows[i]!
		if (row.logicRow !== cursorRow) continue
		const next = rows[i + 1]
		const isLast = next === undefined || next.logicRow !== cursorRow
		// 行长按 code point 计（cursorCol 口径），代理对安全
		const len = Array.from(row.text).length
		const within = cursorCol >= row.colStart && cursorCol <= row.colStart + len
		if (within || (isLast && cursorCol > row.colStart + len)) {
			return { dispRow: i, dispCol: Math.max(0, cursorCol - row.colStart) }
		}
	}
	return { dispRow: Math.max(0, rows.length - 1), dispCol: 0 }
}

function intersect(a: LayoutRect, b: LayoutRect): LayoutRect {
	const x0 = Math.max(a.x, b.x)
	const y0 = Math.max(a.y, b.y)
	const x1 = Math.min(a.x + a.width, b.x + b.width)
	const y1 = Math.min(a.y + a.height, b.y + b.height)
	return { x: x0, y: y0, width: Math.max(0, x1 - x0), height: Math.max(0, y1 - y0) }
}
