import { readStyle, resolveDim } from "../layout/engine"
import type { ElementNode, FallbackNode, LayoutRect } from "../solid/nodes"

/**
 * M2：命中网格（对齐 opentui `RenderContext.addToHitGrid`，见
 * node_modules/@opentui/core/types.d.ts:103-105）。
 *
 * 作用：把「屏幕坐标 → 节点」的映射固化成一张表，鼠标事件先查表再冒泡，
 * 避免每次点击都遍历整棵树。
 *
 * 与绘制保持同一套口径（否则会出现"看得见点不到"）：
 *  - 遍历顺序与 `paintChildren` 一致（zIndex 升序，后写覆盖）
 *  - `visible=false` 不写入（不可见即不可点）
 *  - 容器按内容盒裁剪（border/padding 内缩），scrollbox 按自身矩形裁剪
 *  - 文本节点不单独占格（其父元素已覆盖同一区域，命中父级即可处理）
 */

export interface HitGrid {
	readonly width: number
	readonly height: number
	/** 每格记录 nodes 下标，-1 表示空 */
	readonly cells: Int32Array
	readonly nodes: readonly FallbackNode[]
	/** 查询命中节点；越界返回 undefined */
	at(x: number, y: number): FallbackNode | undefined
}

function intersect(a: LayoutRect, b: LayoutRect): LayoutRect {
	const x0 = Math.max(a.x, b.x)
	const y0 = Math.max(a.y, b.y)
	const x1 = Math.min(a.x + a.width, b.x + b.width)
	const y1 = Math.min(a.y + a.height, b.y + b.height)
	return { x: x0, y: y0, width: Math.max(0, x1 - x0), height: Math.max(0, y1 - y0) }
}

/** 内容盒（border + padding 内缩），与布局引擎 `frameOf` 同口径。 */
function contentRect(el: ElementNode): LayoutRect {
	const style = readStyle(el.props)
	const basis = el.layout.width
	const left = (resolveDim(style.padding.left, basis) ?? 0) + style.border.left
	const right = (resolveDim(style.padding.right, basis) ?? 0) + style.border.right
	const top = (resolveDim(style.padding.top, basis) ?? 0) + style.border.top
	const bottom = (resolveDim(style.padding.bottom, basis) ?? 0) + style.border.bottom
	return {
		x: el.layout.x + Math.floor(left),
		y: el.layout.y + Math.floor(top),
		width: Math.max(0, el.layout.width - Math.floor(left + right)),
		height: Math.max(0, el.layout.height - Math.floor(top + bottom)),
	}
}

function zIndexOf(node: FallbackNode): number {
	if (node.kind !== "element") return 0
	const value = node.props.zIndex
	return typeof value === "number" && Number.isFinite(value) ? value : 0
}

/** 与 paintChildren 相同的子节点顺序：portal 置顶，其余按 zIndex 升序，再按树序。 */
function orderedChildren(el: ElementNode): readonly FallbackNode[] {
	const kids = el.children
	if (kids.length > 1 && kids.some((child) => (child.kind === "element" && child.type === "portal") || zIndexOf(child) !== 0)) {
		return [...kids].sort(
			(a, b) =>
				((a.kind === "element" && a.type === "portal") ? 1 : 0) - ((b.kind === "element" && b.type === "portal") ? 1 : 0) ||
				zIndexOf(a) - zIndexOf(b),
		)
	}
	return kids
}

/**
 * 构建命中网格。root 的 layout 必须已由 `layoutTree` 填充。
 */
export function buildHitGrid(root: ElementNode, width: number, height: number): HitGrid {
	const cells = new Int32Array(Math.max(0, width) * Math.max(0, height)).fill(-1)
	const nodes: FallbackNode[] = []

	const stamp = (node: FallbackNode, clip: LayoutRect) => {
		const rect = intersect(node.layout, clip)
		if (rect.width <= 0 || rect.height <= 0) return
		const index = nodes.length
		nodes.push(node)
		for (let y = rect.y; y < rect.y + rect.height; y++) {
			if (y < 0 || y >= height) continue
			const row = y * width
			for (let x = rect.x; x < rect.x + rect.width; x++) {
				if (x < 0 || x >= width) continue
				cells[row + x] = index
			}
		}
	}

	const walk = (node: FallbackNode, clip: LayoutRect) => {
		if (node.kind === "text") return
		if (node.props.visible === false) return
		stamp(node, clip)
		if (node.type === "text" || node.type === "textarea") return
		const next = node.type === "scrollbox" ? intersect(clip, node.layout) : intersect(clip, contentRect(node))
		for (const child of orderedChildren(node)) walk(child, next)
	}

	walk(root, { x: 0, y: 0, width, height })

	return {
		width,
		height,
		cells,
		nodes,
		at(x: number, y: number) {
			if (x < 0 || y < 0 || x >= width || y >= height) return undefined
			const index = cells[y * width + x]!
			return index >= 0 ? nodes[index] : undefined
		},
	}
}
