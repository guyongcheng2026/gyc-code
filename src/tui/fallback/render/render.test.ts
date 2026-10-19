import { describe, expect, test } from "bun:test"
import { createElementNode, insertNode, type ElementNode } from "../solid/nodes"
import { layoutTree } from "../solid/paint"
import { dispatchKey, dispatchMouse, dispatchPaste, NO_MODIFIERS } from "./events"
import { createFocusManager } from "./focus"
import { buildHitGrid } from "./hit"

function el(type: string, props: Record<string, unknown> = {}): ElementNode {
	const node = createElementNode(type)
	Object.assign(node.props, props)
	return node
}

function tree(root: ElementNode, width = 10, height = 4): ElementNode {
	layoutTree(root, width, height)
	return root
}

describe("命中网格", () => {
	test("命中最后绘制的节点（子覆盖父）", () => {
		const child = el("box", { height: 2 })
		const root = el("root")
		insertNode(root, child)
		tree(root)
		const grid = buildHitGrid(root, 10, 4)
		expect(grid.at(0, 0)).toBe(child)
		expect(grid.at(0, 3)).toBe(root)
	})

	test("zIndex 大者命中", () => {
		const low = el("box", { position: "absolute", top: 0, left: 0, width: 4, height: 2, zIndex: 0 })
		const high = el("box", { position: "absolute", top: 0, left: 0, width: 4, height: 2, zIndex: 1 })
		const root = el("root")
		insertNode(root, low)
		insertNode(root, high)
		tree(root)
		const grid = buildHitGrid(root, 10, 4)
		expect(grid.at(1, 1)).toBe(high)
	})

	test("visible=false 不参与命中", () => {
		const hidden = el("box", { position: "absolute", top: 0, left: 0, width: 4, height: 2, visible: false })
		const root = el("root")
		insertNode(root, hidden)
		tree(root)
		const grid = buildHitGrid(root, 10, 4)
		expect(grid.at(1, 1)).toBe(root)
	})

	test("越界坐标返回 undefined", () => {
		const root = el("root")
		tree(root)
		const grid = buildHitGrid(root, 10, 4)
		expect(grid.at(-1, 0)).toBeUndefined()
		expect(grid.at(0, 9)).toBeUndefined()
	})

	test("border/padding 内缩：内容区外的点击落到父级", () => {
		const inner = el("box", { height: 1 })
		const outer = el("box", { border: "single", padding: 1 })
		insertNode(outer, inner)
		const root = el("root")
		insertNode(root, outer)
		tree(root)
		const grid = buildHitGrid(root, 10, 4)
		expect(grid.at(0, 0)).toBe(outer) // 边框区
		expect(grid.at(2, 2)).toBe(inner) // 内容区
	})
})

describe("焦点链", () => {
	test("focus 后自身与祖先均视为聚焦", () => {
		const child = el("box")
		const parent = el("box")
		insertNode(parent, child)
		const root = el("root")
		insertNode(root, parent)
		const focus = createFocusManager()
		focus.focus(child)
		expect(focus.isSelfFocused(child)).toBe(true)
		expect(focus.isFocused(child)).toBe(true)
		expect(focus.isFocused(parent)).toBe(true)
		expect(focus.isFocused(root)).toBe(true)
		expect(focus.isSelfFocused(parent)).toBe(false)
	})

	test("blur 只在匹配当前焦点时生效", () => {
		const a = el("box")
		const b = el("box")
		const focus = createFocusManager()
		focus.focus(a)
		focus.blur(b)
		expect(focus.current()).toBe(a)
		focus.blur(a)
		expect(focus.current()).toBeUndefined()
	})

	test("onChange 收到新旧焦点并可取消订阅", () => {
		const a = el("box")
		const b = el("box")
		const focus = createFocusManager()
		const seen: Array<[unknown, unknown]> = []
		const off = focus.onChange((current, previous) => seen.push([current, previous]))
		focus.focus(a)
		focus.focus(b)
		off()
		focus.blur()
		expect(seen).toEqual([
			[a, undefined],
			[b, a],
		])
	})
})

describe("事件冒泡", () => {
	test("从命中节点向上冒泡，子先父后", () => {
		const order: string[] = []
		const child = el("box", { onMouseDown: () => order.push("child") })
		const parent = el("box", { onMouseDown: () => order.push("parent") })
		insertNode(parent, child)
		const root = el("root", { onMouseDown: () => order.push("root") })
		insertNode(root, parent)

		const result = dispatchMouse(child, "down", { x: 0, y: 0, button: 0, modifiers: NO_MODIFIERS })
		expect(result.handled).toBe(true)
		expect(order).toEqual(["child", "parent", "root"])
	})

	test("handler 返回 false 停止冒泡", () => {
		const order: string[] = []
		const child = el("box", { onMouseUp: () => (order.push("child"), false) })
		const parent = el("box", { onMouseUp: () => order.push("parent") })
		insertNode(parent, child)
		dispatchMouse(child, "up", { x: 0, y: 0, button: 0, modifiers: NO_MODIFIERS })
		expect(order).toEqual(["child"])
	})

	test("无 handler 时 handled=false", () => {
		const node = el("box")
		expect(dispatchMouse(node, "down", { x: 0, y: 0, button: 0, modifiers: NO_MODIFIERS }).handled).toBe(false)
	})

	test("键盘与粘贴事件走对应 handler", () => {
		const seen: unknown[] = []
		const node = el("box", {
			onKeyDown: (key: unknown) => seen.push(key),
			onPaste: (event: unknown) => seen.push(event),
		})
		dispatchKey(node, { type: "enter" })
		dispatchPaste(node, "hello")
		expect(seen).toEqual([{ type: "enter" }, { text: "hello" }])
	})
})
