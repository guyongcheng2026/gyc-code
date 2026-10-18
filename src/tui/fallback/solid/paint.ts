import type { CellStyle, Screen } from "../screen"
import { charWidth } from "../char-width"
import { highlightCodeLine } from "../highlight"
import { computeLayout, type LayoutNode } from "../layout/engine"
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
			// `<br>` 与文本内换行：强制换行（不占显示宽度）
			if (ch === "\n") {
				flush()
				continue
			}
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

function paddingOf(el: ElementNode): number {
	const p = el.props.padding
	return typeof p === "number" ? Math.max(0, Math.floor(p)) : 0
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

/**
 * 行内元素标签（对齐 opentui `textNodeKeys` + `span`，见
 * node_modules/@opentui/solid/src/elements/catalogue.d.ts:7-53）。
 * 产线 `<span>` 108 处、`<b>` 60 处，是 AI 回复行内样式的主要写法。
 */
const INLINE_TAGS = new Set(["span", "b", "strong", "i", "em", "u", "a", "br"])

export function isInlineTag(type: string): boolean {
	return INLINE_TAGS.has(type)
}

const INLINE_MODIFIERS: Record<string, CellStyle> = {
	b: { bold: true },
	strong: { bold: true },
	i: { italic: true },
	em: { italic: true },
	u: { underline: true },
	a: { underline: true },
}

function mergeStyle(base: CellStyle, extra: CellStyle | undefined): CellStyle {
	if (extra === undefined) return base
	return { ...base, ...extra }
}

/**
 * 把 text 元素的行内内容压成 spans：
 *  - TextNode 继承当前样式；
 *  - 行内元素按标签叠加样式（b/strong → bold，i/em → italic，u/a → underline），
 *    自身 `style` 再覆盖；
 *  - `br` 产出强制换行（由 wrapSpans 消费）。
 */
export function collectSpans(el: ElementNode, inherited: CellStyle = {}): StyledSpan[] {
	const base = mergeStyle(inherited, styleOf(el))
	const out: StyledSpan[] = []
	for (const child of el.children) {
		if (child.kind === "text") {
			out.push({ text: child.text, style: base })
			continue
		}
		if (child.type === "br") {
			out.push({ text: "\n", style: base })
			continue
		}
		out.push(...collectSpans(child, mergeStyle(base, INLINE_MODIFIERS[child.type])))
	}
	return out
}

/** text 元素的内容：显式 `spans` 优先，否则按行内节点收集。 */
function spansFor(el: ElementNode): StyledSpan[] {
	return spansOf(el) ?? collectSpans(el)
}

/**
 * 叶子判定：text/textarea 即使带文本子节点也按叶子测量（文本子节点是内容，
 * 不是布局项）；其余元素无子节点即为叶子。
 */
function isLeaf(node: FallbackNode): boolean {
	if (node.kind === "text") return true
	return (
		node.type === "text" ||
		node.type === "textarea" ||
		node.type === "code" ||
		node.type === "diff" ||
		node.children.length === 0
	)
}

/** `code` 内容：按 filetype 逐行高亮（零原生依赖，见 highlight.ts）。 */
function codeRows(el: ElementNode): StyledSpan[][] {
	const content = typeof el.props.content === "string" ? el.props.content : ""
	const filetype = typeof el.props.filetype === "string" ? el.props.filetype : ""
	return content.split("\n").map((line) => highlightCodeLine(line, filetype))
}

const DIFF_STYLES = {
	meta: { fg: "#6a737d" },
	hunk: { fg: "#005cc5", bold: true },
	add: { fg: "#22863a" },
	del: { fg: "#cb2431" },
	context: {},
} as const satisfies Record<string, CellStyle>

/** 行号列宽（与产线 `showLineNumbers` 的视觉对齐）。 */
const DIFF_NO_WIDTH = 4

function diffNo(value: number | undefined): string {
	return value === undefined ? " ".repeat(DIFF_NO_WIDTH) : String(value).padStart(DIFF_NO_WIDTH)
}

/**
 * `diff` 内容：解析 unified diff 为带样式的行。
 *
 * 支持：`---`/`+++` 头、`@@` hunk 头、`+`/`-`/上下文行、`showLineNumbers`
 * （旧/新双列行号）。不支持 `view="split"` 的左右分栏——按 unified 渲染
 * （记录为已知差异，见计划文档 M5）。
 */
function diffRows(el: ElementNode): StyledSpan[][] {
	const patch = typeof el.props.diff === "string" ? el.props.diff : typeof el.props.content === "string" ? el.props.content : ""
	const showLineNumbers = el.props.showLineNumbers === true
	const rows: StyledSpan[][] = []
	let oldNo: number | undefined
	let newNo: number | undefined

	for (const line of patch.split("\n")) {
		if (line.startsWith("---") || line.startsWith("+++")) {
			rows.push([{ text: line, style: DIFF_STYLES.meta }])
			continue
		}
		const hunk = /^@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@/.exec(line)
		if (hunk) {
			oldNo = Number(hunk[1])
			newNo = Number(hunk[2])
			rows.push([{ text: line, style: DIFF_STYLES.hunk }])
			continue
		}
		const marker = line[0]
		let style: CellStyle = DIFF_STYLES.context
		let oldCell: string | undefined
		let newCell: string | undefined
		if (marker === "+") {
			style = DIFF_STYLES.add
			newCell = diffNo(newNo)
			if (newNo !== undefined) newNo += 1
		} else if (marker === "-") {
			style = DIFF_STYLES.del
			oldCell = diffNo(oldNo)
			if (oldNo !== undefined) oldNo += 1
		} else {
			oldCell = diffNo(oldNo)
			newCell = diffNo(newNo)
			if (oldNo !== undefined) oldNo += 1
			if (newNo !== undefined) newNo += 1
		}
		const prefix = showLineNumbers ? `${oldCell ?? " ".repeat(DIFF_NO_WIDTH)} ${newCell ?? " ".repeat(DIFF_NO_WIDTH)} ` : ""
		rows.push(prefix.length > 0 ? [{ text: prefix, style: DIFF_STYLES.meta }, { text: line, style }] : [{ text: line, style }])
	}
	return rows
}

/** 叶子内容测量（M1 布局引擎注入点）：给定可用宽高，返回内容需要的宽高。 */
function measureLeaf(node: FallbackNode, available: { width: number; height: number }): { width: number; height: number } {
	if (node.kind === "text") {
		const lines = wrapText(node.text, available.width)
		return { width: lines.reduce((m, l) => Math.max(m, textDisplayWidth(l)), 0), height: lines.length }
	}
	if (node.type === "textarea") {
		const rows = wrapTextareaLines(textareaLines(node), available.width)
		return { width: available.width, height: rows.length }
	}
	if (node.type === "code" || node.type === "diff") {
		const rows = node.type === "code" ? codeRows(node) : diffRows(node)
		const height = rows.reduce((total, row) => total + wrapSpans(row, available.width).length, 0)
		return { width: available.width, height }
	}
	if (node.type === "text") {
		const rows = wrapSpans(spansFor(node), available.width)
		return {
			width: rows.reduce((m, r) => Math.max(m, r.reduce((n, s) => n + textDisplayWidth(s.text), 0)), 0),
			height: rows.length,
		}
	}
	return { width: 0, height: 0 }
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

/**
 * 自顶向下布局：root 占满屏幕。
 *
 * M1 起委托给自研 flexbox 引擎（`../layout/engine`）：引擎只做矩形分配，
 * 叶子内容测量经 `measureLeaf` 注入，绘制仍在本文件。scrollbox 的
 * scrollTop 在布局后收敛（引擎不认识"视口"概念）。
 */
export function layoutTree(root: ElementNode, width: number, height: number): void {
	computeLayout(root as unknown as LayoutNode, { width, height }, {
		measureLeaf: (node, available) => measureLeaf(node as unknown as FallbackNode, available),
		isLeaf: (node) => isLeaf(node as unknown as FallbackNode),
	})
	clampScrollTops(root, 0)
}

/**
 * scrollbox 的 scrollTop 收敛到 [0, contentHeight - 视口高]，并把滚动偏移
 * **烘焙进布局坐标**（子树整体平移）。
 *
 * 为什么烘焙而不是 paint 时用 offsetY 平移：clip（视口矩形）与内容绘制
 * y 必须同一坐标系，嵌套 scrollbox 时 offset 链一旦分叉就会裁剪错位（R3）。
 * 烘焙后 layout 即屏幕坐标，clip/命中网格/滚动条全部自然对齐。
 *
 * stickyScroll（对齐 opentui `ScrollBoxOptions.stickyScroll/stickyStart`）：
 * 内容增长时若上一帧仍贴底，则本帧继续贴底；用户手动滚离底部后不再强制跟随。
 * 判定「用户是否手动滚动」靠 requested 是否变化（`stickyRequested` 记录上一帧值）：
 * sticky 自动贴底只改 `node.scrollTop`，不改组件信号。首帧视为未滚动 → 初始贴底。
 */
function clampScrollTops(node: FallbackNode, shift: number): void {
	node.layout.y += shift
	if (node.kind !== "element") return
	let childShift = shift
	if (node.type === "scrollbox") {
		const requested = typeof node.props.scrollTop === "number" ? node.props.scrollTop : 0
		const maxScroll = Math.max(0, node.contentHeight - node.layout.height)
		const sticky = node.props.stickyScroll === true
		const stickyStart = node.props.stickyStart === "top" ? "top" : "bottom"
		const userMoved = node.stickyRequested !== undefined && requested !== node.stickyRequested
		const atEdge = stickyStart === "bottom" ? node.scrollTop >= (node.stickyMaxScroll ?? 0) - 1 : node.scrollTop <= 1
		if (sticky && !userMoved && atEdge) {
			node.scrollTop = stickyStart === "bottom" ? maxScroll : 0
		} else {
			node.scrollTop = Math.min(Math.max(0, requested), maxScroll)
		}
		node.stickyRequested = requested
		node.stickyMaxScroll = maxScroll
		childShift = shift - node.scrollTop
	}
	for (const child of node.children) clampScrollTops(child, childShift)
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
	// visible=false：不参与绘制（opentui Renderable.visible 语义；仍参与布局）
	if (el.props.visible === false) return
	switch (el.type) {
		case "textarea":
			paintTextarea(el, screen, clip)
			return
		case "scrollbox": {
			// 视口裁剪：内容必须限制在 scrollbox 自身矩形内，
			// 否则超出视口的内容会溢出绘制到后续兄弟元素（状态条/输入区）
			const viewport = intersect(clip, el.layout)
			const barVisible = verticalScrollbarVisible(el) && el.contentHeight > el.layout.height
			const contentClip = barVisible ? { ...viewport, width: Math.max(0, viewport.width - 1) } : viewport
			// R3：滚动偏移已在 clampScrollTops 烘焙进 layout，这里不再叠加
			paintChildren(el, screen, contentClip, offsetY)
			if (barVisible) paintVerticalScrollbar(el, screen, viewport, offsetY)
			return
		}
		case "code": {
			const base = styleOf(el) ?? inheritStyle(el)
			paintSpanRows(codeRows(el), el.layout, base, screen, clip, offsetY)
			return
		}
		case "diff": {
			const base = styleOf(el) ?? inheritStyle(el)
			paintSpanRows(diffRows(el), el.layout, base, screen, clip, offsetY)
			return
		}
		case "text": {
			const base = styleOf(el) ?? inheritStyle(el)
			paintSpanLines(spansFor(el), el.layout, base, screen, clip, offsetY)
			return
		}
		default:
			paintBox(el, screen, clip, offsetY)
	}
}

/** 竖直滚动条是否可见（`verticalScrollbarOptions.visible` 优先于 `scrollbarOptions`）。 */
function verticalScrollbarVisible(el: ElementNode): boolean {
	const vertical = el.props.verticalScrollbarOptions
	if (typeof vertical === "object" && vertical !== null && "visible" in vertical) {
		return (vertical as { visible?: unknown }).visible === true
	}
	const common = el.props.scrollbarOptions
	if (typeof common === "object" && common !== null && "visible" in common) {
		return (common as { visible?: unknown }).visible === true
	}
	return false
}

/**
 * 绘制竖直滚动条（占最右一列）：`█` 滑块 + `│` 轨道。
 * 位置与长度按 内容高/视口高/scrollTop 比例计算，与 `ScrollBar` 组件同口径。
 */
function paintVerticalScrollbar(el: ElementNode, screen: Screen, viewport: LayoutRect, offsetY: number): void {
	const height = viewport.height
	if (height <= 0) return
	const content = Math.max(1, el.contentHeight)
	const barLen = Math.max(1, Math.min(height, Math.round((height / content) * height)))
	const maxScroll = Math.max(0, content - height)
	const maxPos = Math.max(0, height - barLen)
	const barPos = maxScroll <= 0 ? 0 : Math.min(maxPos, Math.round((el.scrollTop / maxScroll) * maxPos))
	const x = viewport.x + viewport.width - 1
	for (let i = 0; i < height; i++) {
		const y = viewport.y + i + offsetY
		if (y < 0 || y >= screen.height) continue
		const inBar = i >= barPos && i < barPos + barLen
		screen.writeText(x, y, inBar ? "█" : "│", inBar ? { fg: "#6a737d" } : { fg: "#d0d7de" })
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

/**
 * 子节点绘制顺序：portal 类元素永远最后（根级置顶），其余按 zIndex 升序，
 * 再按树序。无 portal/zIndex 的常规树不排序（避免每帧分配）。
 */
function paintChildren(el: ElementNode, screen: Screen, clip: LayoutRect, offsetY: number): void {
	const kids = el.children
	if (kids.length > 1 && kids.some((child) => paintRank(child) !== 0 || zIndexOf(child) !== 0)) {
		const sorted = [...kids].sort((a, b) => paintRank(a) - paintRank(b) || zIndexOf(a) - zIndexOf(b))
		for (const child of sorted) paintNode(child, screen, clip, offsetY)
		return
	}
	for (const child of kids) paintNode(child, screen, clip, offsetY)
}

/** 排序权重：portal 置顶（1），普通元素按原顺序（0）；同权重内保持稳定。 */
function paintRank(node: FallbackNode): number {
	return node.kind === "element" && node.type === "portal" ? 1 : 0
}

function zIndexOf(node: FallbackNode): number {
	if (node.kind !== "element") return 0
	const value = node.props.zIndex
	return typeof value === "number" && Number.isFinite(value) ? value : 0
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

/** 单行富文本绘制：逐段写入（段样式 = base 与 span.style 合并）。 */
function paintSpanRow(
	row: readonly StyledSpan[],
	x: number,
	y: number,
	maxWidth: number,
	base: CellStyle | undefined,
	screen: Screen,
	clip: LayoutRect,
): void {
	if (y < clip.y || y >= clip.y + clip.height) return
	let cx = x
	for (const span of row) {
		const visibleWidth = Math.min(maxWidth - (cx - x), clip.x + clip.width - cx)
		if (visibleWidth <= 0) break
		const visible = clipLine(span.text, visibleWidth)
		if (visible.length > 0) {
			screen.writeText(cx, y, visible, { ...(base ?? {}), ...span.style })
		}
		cx += textDisplayWidth(visible)
	}
}

/** 富文本行绘制：spans wrap 后逐行写入。 */
function paintSpanLines(
	spans: readonly StyledSpan[],
	rect: LayoutRect,
	base: CellStyle | undefined,
	screen: Screen,
	clip: LayoutRect,
	offsetY: number,
): void {
	const rows = wrapSpans(spans, rect.width)
	rows.forEach((row, index) => paintSpanRow(row, rect.x, rect.y + index + offsetY, rect.width, base, screen, clip))
}

/** 逐行渲染已切分的内容（code/diff）：每行独立 wrap，行号随之自然折行。 */
function paintSpanRows(
	rows: readonly StyledSpan[][],
	rect: LayoutRect,
	base: CellStyle | undefined,
	screen: Screen,
	clip: LayoutRect,
	offsetY: number,
): void {
	let y = rect.y + offsetY
	for (const row of rows) {
		for (const line of wrapSpans(row, rect.width)) {
			paintSpanRow(line, rect.x, y, rect.width, base, screen, clip)
			y += 1
		}
	}
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
