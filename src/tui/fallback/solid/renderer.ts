import { createRenderer as createUniversalRenderer, type Renderer } from "solid-js/universal"
import type { FallbackRenderer } from "../terminal"
import {
	createElementNode,
	createFallbackTextNode,
	getFirstChild,
	getNextSibling,
	getParentNode,
	insertNode,
	isTextNode,
	removeNode,
	type ElementNode,
	type FallbackNode,
} from "./nodes"
import { layoutTree, paintTree } from "./paint"

/**
 * S1 组件桥接：Solid universal reconciler 绑定。
 *
 * solid-js/universal 的 createRenderer 提供 insert/reconcile 完整运行时，
 * 此处把 10 个节点操作接到区域树；树变更统一走 markDirty → 微任务全量
 * paint（布局 + Screen 重写），字节增量由 FallbackRenderer 差分引擎负责。
 */

let activeRenderer: FallbackRenderer | undefined
let rootElement: ElementNode | undefined
let paintScheduled = false

function markDirty(): void {
	if (paintScheduled || activeRenderer === undefined || rootElement === undefined) return
	paintScheduled = true
	queueMicrotask(() => {
		paintScheduled = false
		repaint()
	})
}

function repaint(): void {
	const renderer = activeRenderer
	const root = rootElement
	if (renderer === undefined || root === undefined) return
	const screen = renderer.currentScreen
	screen.clear()
	layoutTree(root, screen.width, screen.height)
	paintTree(root, screen)
	renderer.present(() => {})
}

/** 同步强刷一帧（测试与退出前兜底）。 */
export function flushSync(): void {
	if (paintScheduled) {
		paintScheduled = false
		repaint()
	}
}

const solid: Renderer<FallbackNode> = createUniversalRenderer<FallbackNode>({
	createElement(tag) {
		const node = createElementNode(tag)
		markDirty()
		return node
	},
	createTextNode(value) {
		const node = createFallbackTextNode(value)
		markDirty()
		return node
	},
	replaceText(node, value) {
		if (isTextNode(node)) {
			node.text = value
			markDirty()
		}
	},
	isTextNode,
	setProperty(node, name, value) {
		if (node.kind !== "element") return
		// ref 特判：函数式 ref 立即回调（元素节点本身）；对象式写入 current
		if (name === "ref") {
			if (typeof value === "function") value(node)
			else if (typeof value === "object" && value !== null) (value as unknown as { current: unknown }).current = node
			return
		}
		node.props[name] = value
		markDirty()
	},
	insertNode(parent, node, anchor) {
		insertNode(parent, node, anchor)
		markDirty()
	},
	removeNode(parent, node) {
		removeNode(parent, node)
		markDirty()
	},
	getParentNode,
	getFirstChild,
	getNextSibling,
})

/**
 * 挂载 Solid 组件树到 fallback 渲染器。返回 dispose（卸载并停用全局绑定）。
 * 期间树变更自动微任务重绘；resize 经 setResizeRepaint 同步重布局后输出
 * （S1 slice 2：消除旧布局中间帧）。
 *
 * app 返回值类型放宽：JSX 值可能是节点、组件 thunk 或数组
 * （与 SolidJSX.Element 联合对齐，运行时由 insert 归一化）。
 */
export function renderRoot(app: () => unknown, renderer: FallbackRenderer): () => void {
	activeRenderer = renderer
	rootElement = createElementNode("root")
	renderer.setResizeRepaint(() => {
		if (rootElement === undefined) return
		const screen = renderer.currentScreen
		layoutTree(rootElement, screen.width, screen.height)
		paintTree(rootElement, screen)
	})
	const disposeTree = solid.render(app as () => FallbackNode, rootElement)
	return () => {
		disposeTree()
		renderer.setResizeRepaint(() => {})
		rootElement = undefined
		activeRenderer = undefined
	}
}

export const solidRenderer = solid
export const { createComponent, createElement, createTextNode, insert, spread } = solid
