import { onCleanup } from "solid-js"
import { createElementNode, insertNode, removeNode, type ElementNode } from "./nodes"
import { getRootNode, insert } from "./renderer"
import type { JSX } from "./jsx-runtime"

/**
 * M7：Portal（对齐 @opentui/solid `extras.d.ts:11-15`，产线 3 处使用）。
 *
 * 语义：children 脱离当前布局流，挂到根节点末尾（最后绘制 → 天然置顶），
 * 并以 absolute + 百分比尺寸覆盖全屏——不挤压兄弟元素。
 * 需要层级控制时传 `zIndex`（透传到宿主元素）。
 *
 * 实现：组件本身返回一个零尺寸占位元素（避免宿主布局被 children 挤压），
 * 真正的宿主 `<portal>` 手动插到根节点，children 用响应式 `insert` 渲染进去。
 */
export interface PortalProps {
	readonly children?: unknown
	readonly zIndex?: number
}

export function Portal(props: PortalProps): JSX.Element {
	const host = createElementNode("portal")
	Object.assign(host.props, {
		position: "absolute",
		top: 0,
		left: 0,
		width: "100%",
		height: "100%",
		...(props.zIndex !== undefined ? { zIndex: props.zIndex } : {}),
	})
	const root = getRootNode()
	if (root !== undefined) insertNode(root, host)
	// 响应式插入 children 到宿主（insert 返回的是节点，不是清理函数）
	insert(host, () => props.children)
	onCleanup(() => {
		if (host.parent !== undefined) removeNode(host.parent, host)
	})
	// 零尺寸占位：让 reconciler 有节点可插，又不影响宿主布局
	const placeholder = createElementNode("box")
	Object.assign(placeholder.props, { width: 0, height: 0 })
	return placeholder as unknown as JSX.Element
}
