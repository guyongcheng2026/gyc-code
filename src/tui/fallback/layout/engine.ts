/**
 * M1：自研 Flexbox 布局引擎（替代 Yoga 的终端子集）。
 *
 * 为什么自研：替代目标是「零原生 / 零 wasm 依赖」，不能把 Yoga 带进来；产线
 * 真实用到的属性集中在 flexDirection / flexGrow / flexShrink / gap /
 * padding* / alignItems / justifyContent / position absolute（统计见
 * `node scripts/scan-opentui-surface.mjs`），确定性实现即可覆盖，且每行可单测。
 *
 * 与 Yoga 的差异（显式记录，避免"看起来一样"的错觉）：
 *  - 不支持 `baseline` 对齐（终端无字体基线，产线 0 处使用）。
 *  - 不支持 `direction: rtl`（产线 0 处）。
 *  - box-sizing 固定 border-box；百分比宽高相对父内容盒，百分比 margin/padding
 *    相对父内容盒宽度（CSS 规则）。
 *  - 尺寸取整用 `Math.floor`（终端只有整格），与 Yoga 浮点结果在 .5 边界可能差 1 格。
 *  - `align-content` 未实现：多行按 flex-start 堆叠。
 *
 * 三段式：`readStyle`（属性归一化）→ `measure`（固有尺寸）→ `layoutNode`（分配定位）。
 * 叶子内容（text/textarea）的测量由调用方注入 `measureLeaf`，本模块不关心换行规则。
 */

export type Dim = number | `${number}%` | "auto"

export interface Edges<T> {
	readonly top: T
	readonly right: T
	readonly bottom: T
	readonly left: T
}

export type FlexDirection = "row" | "column" | "row-reverse" | "column-reverse"
export type WrapMode = "no-wrap" | "wrap" | "wrap-reverse"
export type Align = "flex-start" | "center" | "flex-end" | "stretch"
export type Justify = "flex-start" | "center" | "flex-end" | "space-between" | "space-around" | "space-evenly"
export type PositionType = "relative" | "absolute" | "static"

export interface LayoutStyle {
	readonly width: Dim
	readonly height: Dim
	readonly minWidth: Dim
	readonly minHeight: Dim
	readonly maxWidth: Dim
	readonly maxHeight: Dim
	readonly flexGrow: number
	readonly flexShrink: number
	readonly flexBasis: Dim
	readonly flexDirection: FlexDirection
	readonly flexWrap: WrapMode
	readonly alignItems: Align
	readonly alignSelf: Align | "auto"
	readonly justifyContent: Justify
	readonly position: PositionType
	readonly inset: Edges<Dim>
	readonly margin: Edges<Dim | "auto">
	readonly padding: Edges<Dim>
	readonly border: Edges<number>
	readonly rowGap: number
	readonly columnGap: number
}

export interface LayoutRect {
	x: number
	y: number
	width: number
	height: number
}

/** 引擎需要的节点结构（与 fallback 的 ElementNode/TextNode 结构兼容）。 */
export interface LayoutNode {
	readonly type: string
	readonly props: Record<string, unknown>
	readonly children: readonly LayoutNode[]
	layout: LayoutRect
	/** 容器内容主轴总尺寸（scrollbox 裁剪与 textarea 滚动用）。 */
	contentHeight?: number
}

export interface MeasureLeafResult {
	readonly width: number
	readonly height: number
}

export interface LayoutOptions {
	/** 叶子内容测量：给定可用宽高，返回内容需要的宽高（不含 margin/padding/border）。 */
	measureLeaf(node: LayoutNode, available: { width: number; height: number }): MeasureLeafResult
	/**
	 * 叶子判定。缺省按「无子节点」。调用方可覆盖：`text`/`textarea` 即使带
	 * 文本子节点也是叶子（文本子节点是内容，不是布局项）。
	 */
	isLeaf?(node: LayoutNode): boolean
}

function isLeafOf(node: LayoutNode, opts: LayoutOptions): boolean {
	if (opts.isLeaf !== undefined) return opts.isLeaf(node)
	return (node.children?.length ?? 0) === 0
}

function num(value: unknown, fallback = 0): number {
	return typeof value === "number" && Number.isFinite(value) ? value : fallback
}

function dim(value: unknown): Dim {
	if (typeof value === "number" && Number.isFinite(value)) return value
	if (typeof value === "string" && /^-?\d+(\.\d+)?%$/.test(value)) return value as `${number}%`
	return "auto"
}

/** 百分比相对基准解析；"auto" 返回 undefined。 */
export function resolveDim(value: Dim, basis: number): number | undefined {
	if (value === "auto") return undefined
	if (typeof value === "number") return value
	const ratio = Number.parseFloat(value) / 100
	return Number.isFinite(basis) ? (basis * ratio) : undefined
}

function edgesOf<T>(value: unknown, fallback: T, map: (v: unknown) => T): Edges<T> {
	if (typeof value === "object" && value !== null) {
		const obj = value as Record<string, unknown>
		const pick = (key: string, or: T): T => (key in obj ? map(obj[key]) : or)
		const vertical = "vertical" in obj ? map(obj.vertical) : undefined
		const horizontal = "horizontal" in obj ? map(obj.horizontal) : undefined
		return {
			top: pick("top", vertical ?? fallback),
			bottom: pick("bottom", vertical ?? fallback),
			left: pick("left", horizontal ?? fallback),
			right: pick("right", horizontal ?? fallback),
		}
	}
	if (value === undefined || value === null) return { top: fallback, right: fallback, bottom: fallback, left: fallback }
	const all = map(value)
	return { top: all, right: all, bottom: all, left: all }
}

/** 边框：true/"single"/"double"/"rounded"/"heavy" 全边 1；数组形式按边（对齐 opentui BorderSides[]）。 */
function borderEdges(value: unknown): Edges<number> {
	if (Array.isArray(value)) {
		const set = new Set(value.filter((v): v is string => typeof v === "string"))
		return {
			top: set.has("top") ? 1 : 0,
			right: set.has("right") ? 1 : 0,
			bottom: set.has("bottom") ? 1 : 0,
			left: set.has("left") ? 1 : 0,
		}
	}
	const on = value === true || value === "single" || value === "double" || value === "rounded" || value === "heavy"
	const n = on ? 1 : 0
	return { top: n, right: n, bottom: n, left: n }
}

/**
 * 属性归一化。同时兼容两套写法：
 *  - opentui/Yoga：`flexGrow`、`flexDirection`、`paddingLeft`、`gap`、`position`
 *  - fallback 既有：`flex: true`、`direction: "row"`、`padding: 2`
 */
export function readStyle(props: Record<string, unknown>): LayoutStyle {
	const legacyFlex = props.flex === true
	const direction = props.flexDirection ?? props.direction
	const flexDirection: FlexDirection =
		direction === "row"
			? "row"
			: direction === "row-reverse"
				? "row-reverse"
				: direction === "column-reverse"
					? "column-reverse"
					: "column"

	const wrap = props.flexWrap
	const flexWrap: WrapMode = wrap === "wrap" ? "wrap" : wrap === "wrap-reverse" ? "wrap-reverse" : "no-wrap"

	const align = (value: unknown, fallback: Align): Align =>
		value === "flex-start" || value === "center" || value === "flex-end" || value === "stretch" ? value : fallback

	const justifyRaw = props.justifyContent
	const justifyContent: Justify =
		justifyRaw === "center" ||
		justifyRaw === "flex-end" ||
		justifyRaw === "space-between" ||
		justifyRaw === "space-around" ||
		justifyRaw === "space-evenly"
			? justifyRaw
			: "flex-start"

	const positionRaw = props.position
	const position: PositionType = positionRaw === "absolute" ? "absolute" : positionRaw === "static" ? "static" : "relative"

	const basePadding = edgesOf<Dim>(props.padding, 0, dim)
	const padX = props.paddingX
	const padY = props.paddingY
	const padding: Edges<Dim> = {
		top: padY !== undefined ? dim(padY) : basePadding.top,
		bottom: padY !== undefined ? dim(padY) : basePadding.bottom,
		left: padX !== undefined ? dim(padX) : basePadding.left,
		right: padX !== undefined ? dim(padX) : basePadding.right,
	}

	const gap = num(props.gap, 0)

	return {
		width: dim(props.width),
		height: dim(props.height),
		minWidth: dim(props.minWidth),
		minHeight: dim(props.minHeight),
		maxWidth: dim(props.maxWidth),
		maxHeight: dim(props.maxHeight),
		flexGrow: num(props.flexGrow, legacyFlex ? 1 : 0),
		flexShrink: num(props.flexShrink, legacyFlex ? 1 : 0),
		flexBasis: props.flexBasis === undefined ? (legacyFlex ? 0 : "auto") : dim(props.flexBasis),
		flexDirection,
		flexWrap,
		alignItems: align(props.alignItems, "stretch"),
		alignSelf: props.alignSelf === "auto" || props.alignSelf === undefined ? "auto" : align(props.alignSelf, "stretch"),
		justifyContent,
		position,
		inset: { top: dim(props.top), right: dim(props.right), bottom: dim(props.bottom), left: dim(props.left) },
		margin: edgesOf<Dim | "auto">(props.margin, 0, (v) => (v === "auto" ? "auto" : dim(v))),
		padding,
		border: borderEdges(props.border),
		rowGap: num(props.rowGap, gap),
		columnGap: num(props.columnGap, gap),
	}
}

interface Frame {
	/** padding+border 占用的水平/垂直尺寸 */
	readonly h: number
	readonly v: number
	readonly left: number
	readonly top: number
}

function frameOf(style: LayoutStyle, basisWidth: number): Frame {
	const padLeft = resolveDim(style.padding.left, basisWidth) ?? 0
	const padRight = resolveDim(style.padding.right, basisWidth) ?? 0
	const padTop = resolveDim(style.padding.top, basisWidth) ?? 0
	const padBottom = resolveDim(style.padding.bottom, basisWidth) ?? 0
	const left = Math.max(0, Math.floor(style.border.left + padLeft))
	const top = Math.max(0, Math.floor(style.border.top + padTop))
	const h = Math.max(0, Math.floor(style.border.left + style.border.right + padLeft + padRight))
	const v = Math.max(0, Math.floor(style.border.top + style.border.bottom + padTop + padBottom))
	return { h, v, left, top }
}

function marginOf(style: LayoutStyle, basis: number): Edges<number> {
	const one = (d: Dim | "auto") => (d === "auto" ? 0 : (resolveDim(d, basis) ?? 0))
	return {
		top: one(style.margin.top),
		right: one(style.margin.right),
		bottom: one(style.margin.bottom),
		left: one(style.margin.left),
	}
}

function clampSize(value: number, min: number | undefined, max: number | undefined): number {
	let out = value
	if (min !== undefined) out = Math.max(out, min)
	if (max !== undefined) out = Math.min(out, max)
	return Math.max(0, out)
}

interface Measured {
	/** 含 padding/border、不含 margin */
	readonly width: number
	readonly height: number
	/** 内容主轴总尺寸（scrollbox / textarea 用） */
	readonly content: number
}

/** 固有尺寸：给定外部可用空间，求"需要多大"。 */
function measure(node: LayoutNode, available: { width: number; height: number }, opts: LayoutOptions): Measured {
	const style = readStyle(node.props ?? {})
	const frame = frameOf(style, available.width)

	const explicitW = resolveDim(style.width, available.width)
	const explicitH = resolveDim(style.height, available.height)
	const minW = resolveDim(style.minWidth, available.width)
	const maxW = resolveDim(style.maxWidth, available.width)
	const minH = resolveDim(style.minHeight, available.height)
	const maxH = resolveDim(style.maxHeight, available.height)

	const innerW = Math.max(0, (explicitW ?? available.width) - frame.h)
	const innerH = Math.max(0, (explicitH ?? available.height) - frame.v)

	if (isLeafOf(node, opts)) {
		const leaf = opts.measureLeaf(node, { width: innerW, height: innerH })
		return {
			width: clampSize(explicitW ?? leaf.width + frame.h, minW, maxW),
			height: clampSize(explicitH ?? leaf.height + frame.v, minH, maxH),
			content: leaf.height,
		}
	}

	const row = style.flexDirection === "row" || style.flexDirection === "row-reverse"
	let main = 0
	let cross = 0
	let count = 0
	for (const child of node.children ?? []) {
		const cs = readStyle(child.props ?? {})
		if (cs.position === "absolute") continue
		const m = measure(child, { width: innerW, height: innerH }, opts)
		const mg = marginOf(cs, innerW)
		if (row) {
			main += m.width + mg.left + mg.right
			cross = Math.max(cross, m.height + mg.top + mg.bottom)
		} else {
			main += m.height + mg.top + mg.bottom
			cross = Math.max(cross, m.width + mg.left + mg.right)
		}
		count += 1
	}
	const gapMain = row ? style.columnGap : style.rowGap
	if (count > 1) main += gapMain * (count - 1)

	const contentW = row ? main : cross
	const contentH = row ? cross : main
	return {
		width: clampSize(explicitW ?? contentW + frame.h, minW, maxW),
		height: clampSize(explicitH ?? contentH + frame.v, minH, maxH),
		content: main,
	}
}

interface FlowItem {
	readonly node: LayoutNode
	readonly style: LayoutStyle
	/** 主轴尺寸（不含 margin） */
	readonly baseMain: number
	/** 交叉轴尺寸（不含 margin） */
	readonly baseCross: number
	readonly margin: Edges<number>
}

/** 布局入口：root 占满给定矩形。 */
export function computeLayout(root: LayoutNode, size: { width: number; height: number }, opts: LayoutOptions): void {
	layoutNode(root, { x: 0, y: 0, width: Math.max(0, Math.floor(size.width)), height: Math.max(0, Math.floor(size.height)) }, opts)
}

function layoutNode(node: LayoutNode, rawRect: LayoutRect, opts: LayoutOptions): void {
	const style = readStyle(node.props ?? {})
	// R2：坐标/尺寸在此统一取整——终端只有整格，浮点索引会让 Screen 丢格
	const rect: LayoutRect = {
		x: Math.round(rawRect.x),
		y: Math.round(rawRect.y),
		width: Math.max(0, Math.round(rawRect.width)),
		height: Math.max(0, Math.round(rawRect.height)),
	}
	node.layout = { ...rect }
	const frame = frameOf(style, rect.width)

	if (isLeafOf(node, opts)) {
		const leaf = opts.measureLeaf(node, {
			width: Math.max(0, rect.width - frame.h),
			height: Math.max(0, rect.height - frame.v),
		})
		node.contentHeight = leaf.height
		return
	}

	const content: LayoutRect = {
		x: rect.x + frame.left,
		y: rect.y + frame.top,
		width: Math.max(0, rect.width - frame.h),
		height: Math.max(0, rect.height - frame.v),
	}

	const row = style.flexDirection === "row" || style.flexDirection === "row-reverse"
	const reverse = style.flexDirection === "row-reverse" || style.flexDirection === "column-reverse"
	const availMain = row ? content.width : content.height
	const availCross = row ? content.height : content.width
	const gapMain = row ? style.columnGap : style.rowGap
	const gapCross = row ? style.rowGap : style.columnGap

	// 1) 流内子项：测量基准尺寸（不含 margin）
	const items: FlowItem[] = []
	for (const child of node.children ?? []) {
		const cs = readStyle(child.props ?? {})
		if (cs.position === "absolute") continue
		const m = measure(child, { width: content.width, height: content.height }, opts)
		const mg = marginOf(cs, content.width)
		const basis = resolveDim(cs.flexBasis, availMain)
		items.push({
			node: child,
			style: cs,
			baseMain: basis ?? (row ? m.width : m.height),
			baseCross: row ? m.height : m.width,
			margin: mg,
		})
	}

	// 2) 分行（flexWrap）
	const lines: FlowItem[][] = []
	let line: FlowItem[] = []
	let used = 0
	for (const item of items) {
		const outer = item.baseMain + mainMargins(item, row)
		const next = line.length === 0 ? outer : used + gapMain + outer
		if (style.flexWrap !== "no-wrap" && line.length > 0 && next > availMain) {
			lines.push(line)
			line = [item]
			used = outer
			continue
		}
		line.push(item)
		used = next
	}
	if (line.length > 0) lines.push(line)
	if (style.flexWrap === "wrap-reverse") lines.reverse()

	// 3) 每行：grow/shrink → 行内交叉尺寸
	const sizes: number[][] = []
	const lineCross: number[] = []
	let totalMain = 0
	let naturalCross = 0
	for (let i = 0; i < lines.length; i++) {
		const current = lines[i]!
		const gaps = current.length > 1 ? gapMain * (current.length - 1) : 0
		const outerSum = current.reduce((acc, item) => acc + item.baseMain + mainMargins(item, row), 0)
		const allocated = distribute(current, availMain - outerSum - gaps, row, availMain)
		sizes.push(allocated)
		let crossSize = 0
		for (let j = 0; j < current.length; j++) {
			const item = current[j]!
			crossSize = Math.max(crossSize, crossSizeOf(item, allocated[j]!, availCross, row))
			naturalCross = Math.max(naturalCross, item.baseCross + crossMargins(item, row))
		}
		// 单行容器（no-wrap）的行高取容器交叉尺寸：alignItems:center/flex-end 才有意义
		// （与 Yoga 一致；wrap 时每行取该行最高子项）
		lineCross.push(style.flexWrap === "no-wrap" ? availCross : crossSize)
		totalMain += current.reduce((acc, item, j) => acc + allocated[j]! + mainMargins(item, row), 0) + gaps
		if (i < lines.length - 1) totalMain += gapCross
	}

	node.contentHeight = row ? naturalCross : totalMain

	// 4) 逐行定位：主轴按行内 justify，交叉轴按行号累加（换行时行沿交叉轴堆叠）
	let crossCursor = 0
	for (let i = 0; i < lines.length; i++) {
		const current = lines[i]!
		const gaps = current.length > 1 ? gapMain * (current.length - 1) : 0
		const lineMain = current.reduce((acc, item, j) => acc + sizes[i]![j]! + mainMargins(item, row), 0) + gaps
		const extra = Math.max(0, availMain - lineMain)
		const { offset, spacing } = justify(style.justifyContent, extra, current.length)
		let pos = offset
		for (let j = 0; j < current.length; j++) {
			const item = current[j]!
			const mainSize = sizes[i]![j]!
			const crossSize = crossSizeOf(item, mainSize, availCross, row)
			const align = item.style.alignSelf === "auto" ? style.alignItems : item.style.alignSelf
			const lineSize = lineCross[i]!
			const crossOffset = alignOffset(align, lineSize, crossSize + crossMargins(item, row))

			// space-between 末项必须贴边（取整丢掉的零头归入末段间距）
			const isLast = j === current.length - 1
			const basePos =
				style.justifyContent === "space-between" && isLast && extra > 0
					? availMain - mainSize - mainMargins(item, row)
					: pos
			const mainPos = basePos + mainBefore(item, row)
			const crossPos = crossCursor + crossOffset + crossBefore(item, row)

			const childRect: LayoutRect = row
				? { x: content.x + mainPos, y: content.y + crossPos, width: mainSize, height: crossSize }
				: { x: content.x + crossPos, y: content.y + mainPos, width: crossSize, height: mainSize }

			layoutNode(item.node, childRect, opts)
			pos += mainSize + mainMargins(item, row) + gapMain + spacing
		}
		crossCursor += lineCross[i]! + gapCross
	}

	// 5) 绝对定位子项：相对 padding box
	for (const child of node.children ?? []) {
		const cs = readStyle(child.props ?? {})
		if (cs.position !== "absolute") continue
		const m = measure(child, { width: content.width, height: content.height }, opts)
		const width = resolveDim(cs.width, content.width) ?? m.width
		const height = resolveDim(cs.height, content.height) ?? m.height
		const left = resolveDim(cs.inset.left, content.width)
		const right = resolveDim(cs.inset.right, content.width)
		const top = resolveDim(cs.inset.top, content.height)
		const bottom = resolveDim(cs.inset.bottom, content.height)
		const x =
			left !== undefined
				? content.x + left
				: right !== undefined
					? content.x + content.width - right - width
					: content.x
		const y =
			top !== undefined
				? content.y + top
				: bottom !== undefined
					? content.y + content.height - bottom - height
					: content.y
		layoutNode(child, { x, y, width, height }, opts)
	}

	if (reverse) {
		// R4：反向只镜像流内子项——absolute 子项按 inset 定位，不应被镜像
		for (const child of node.children ?? []) {
			const cs = readStyle(child.props ?? {})
			if (cs.position === "absolute") continue
			const c = child.layout
			if (row) c.x = content.x + content.width - (c.x - content.x) - c.width
			else c.y = content.y + content.height - (c.y - content.y) - c.height
		}
	}
}

function mainMargins(item: FlowItem, row: boolean): number {
	return row ? item.margin.left + item.margin.right : item.margin.top + item.margin.bottom
}

function crossMargins(item: FlowItem, row: boolean): number {
	return row ? item.margin.top + item.margin.bottom : item.margin.left + item.margin.right
}

function mainBefore(item: FlowItem, row: boolean): number {
	return row ? item.margin.left : item.margin.top
}

function crossBefore(item: FlowItem, row: boolean): number {
	return row ? item.margin.top : item.margin.left
}

function crossSizeOf(item: FlowItem, mainSize: number, availCross: number, row: boolean): number {
	const style = item.style
	const dimCross = row ? style.height : style.width
	const minCross = row ? style.minHeight : style.minWidth
	const maxCross = row ? style.maxHeight : style.maxWidth
	const explicit = resolveDim(dimCross, availCross)
	const min = resolveDim(minCross, availCross)
	const max = resolveDim(maxCross, availCross)
	if (explicit !== undefined) return clampSize(explicit, min, max)
	const align = style.alignSelf === "auto" ? "stretch" : style.alignSelf
	if (align === "stretch") {
		return clampSize(Math.max(0, availCross - crossMargins(item, row)), min, max)
	}
	void mainSize
	return clampSize(item.baseCross, min, max)
}

function alignOffset(align: Align, lineCross: number, crossOuter: number): number {
	if (align === "flex-end") return Math.max(0, lineCross - crossOuter)
	if (align === "center") return Math.max(0, Math.floor((lineCross - crossOuter) / 2))
	return 0
}

/** grow / shrink 分配：返回每项主轴尺寸（不含 margin，已取整——R2）。 */
function distribute(line: FlowItem[], free: number, row: boolean, availMain: number): number[] {
	const sizes = line.map((item) => item.baseMain)
	if (free > 0) {
		const totalGrow = line.reduce((acc, item) => acc + Math.max(0, item.style.flexGrow), 0)
		if (totalGrow <= 0) return sizes.map((size, i) => clampItemMain(line[i]!, size, row, availMain))
		return sizes.map((size, i) =>
			clampItemMain(line[i]!, Math.floor(size + (free * Math.max(0, line[i]!.style.flexGrow)) / totalGrow), row, availMain),
		)
	}
	if (free < 0) {
		const totalShrink = line.reduce((acc, item) => acc + Math.max(0, item.style.flexShrink) * item.baseMain, 0)
		if (totalShrink <= 0) return sizes.map((size, i) => clampItemMain(line[i]!, size, row, availMain))
		return sizes.map((size, i) => {
			const factor = Math.max(0, line[i]!.style.flexShrink) * line[i]!.baseMain
			return clampItemMain(line[i]!, Math.max(0, Math.floor(size + (free * factor) / totalShrink)), row, availMain)
		})
	}
	return sizes.map((size, i) => clampItemMain(line[i]!, size, row, availMain))
}

function clampItemMain(item: FlowItem, size: number, row: boolean, availMain: number): number {
	const min = resolveDim(row ? item.style.minWidth : item.style.minHeight, availMain)
	const max = resolveDim(row ? item.style.maxWidth : item.style.maxHeight, availMain)
	return clampSize(size, min, max)
}

function justify(mode: Justify, extra: number, count: number): { offset: number; spacing: number } {
	if (count === 0 || extra <= 0) return { offset: 0, spacing: 0 }
	switch (mode) {
		case "center":
			return { offset: Math.floor(extra / 2), spacing: 0 }
		case "flex-end":
			return { offset: extra, spacing: 0 }
		case "space-between":
			return count > 1 ? { offset: 0, spacing: Math.floor(extra / (count - 1)) } : { offset: 0, spacing: 0 }
		case "space-around":
			return { offset: Math.floor(extra / count / 2), spacing: Math.floor(extra / count) }
		case "space-evenly":
			return { offset: Math.floor(extra / (count + 1)), spacing: Math.floor(extra / (count + 1)) }
		default:
			return { offset: 0, spacing: 0 }
	}
}

/** 供测试：导出树中所有节点的矩形（深度优先）。 */
export function dumpLayout(
	node: LayoutNode,
	out: Array<{ type: string; rect: LayoutRect }> = [],
): Array<{ type: string; rect: LayoutRect }> {
	out.push({ type: node.type, rect: { ...node.layout } })
	for (const child of node.children) dumpLayout(child, out)
	return out
}
