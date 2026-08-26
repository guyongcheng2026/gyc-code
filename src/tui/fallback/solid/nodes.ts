/**
 * S1 组件桥接：区域树节点模型。
 *
 * Solid universal reconciler 的节点 = 元素（区域容器）或文本。
 * 树操作本身零渲染语义；布局与绘制见 paint.ts，reconciler 绑定见 renderer.ts。
 */

export interface LayoutRect {
	x: number
	y: number
	width: number
	height: number
}

export interface ElementNode {
	readonly kind: "element"
	type: string
	props: Record<string, unknown>
	parent: FallbackNode | undefined
	children: FallbackNode[]
	/** paint 阶段填充的布局矩形 */
	layout: LayoutRect
	/** paint 阶段计算的内容总高度（scrollbox 量算用） */
	contentHeight: number
	/** scrollbox：paint 阶段 clamp 后的实际 scrollTop（供 scrollBy 读取） */
	scrollTop: number
	/** 量算缓存（slice B 性能优化）：{宽度, 结果}——props/子树变更时失效 */
	measureCache: { width: number; value: number } | undefined
}

export interface TextNode {
	readonly kind: "text"
	text: string
	parent: FallbackNode | undefined
	/** paint 阶段填充的布局矩形 */
	layout: LayoutRect
}

export type FallbackNode = ElementNode | TextNode

export function createElementNode(type: string): ElementNode {
	return {
		kind: "element",
		type,
		props: {},
		parent: undefined,
		children: [],
		layout: { x: 0, y: 0, width: 0, height: 0 },
		contentHeight: 0,
		scrollTop: 0,
		measureCache: undefined,
	}
}

export function createFallbackTextNode(value: string): TextNode {
	return { kind: "text", text: value, parent: undefined, layout: { x: 0, y: 0, width: 0, height: 0 } }
}

export function isTextNode(node: FallbackNode): node is TextNode {
	return node.kind === "text"
}

export function insertNode(parent: FallbackNode, node: FallbackNode, anchor?: FallbackNode): void {
	if (parent.kind !== "element") return
	const index = anchor === undefined ? parent.children.length : parent.children.indexOf(anchor)
	const at = index < 0 ? parent.children.length : index
	parent.children.splice(at, 0, node)
	node.parent = parent
}

export function removeNode(parent: FallbackNode, node: FallbackNode): void {
	if (parent.kind !== "element") return
	const index = parent.children.indexOf(node)
	if (index >= 0) parent.children.splice(index, 1)
	node.parent = undefined
}

export function getParentNode(node: FallbackNode): FallbackNode | undefined {
	return node.parent
}

export function getFirstChild(node: FallbackNode): FallbackNode | undefined {
	if (node.kind !== "element") return undefined
	return node.children[0]
}

export function getNextSibling(node: FallbackNode): FallbackNode | undefined {
	const parent = node.parent
	if (parent === undefined || parent.kind !== "element") return undefined
	const siblings = parent.children
	const index = siblings.indexOf(node)
	return index >= 0 ? siblings[index + 1] : undefined
}
