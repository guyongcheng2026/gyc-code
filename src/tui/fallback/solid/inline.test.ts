import { describe, expect, test } from "bun:test"
import { Screen } from "../screen"
import { captureSpans } from "../testing/capture"
import { createElementNode, createFallbackTextNode, insertNode, type ElementNode } from "./nodes"
import { layoutTree, paintTree } from "./paint"

function el(type: string, props: Record<string, unknown> = {}): ElementNode {
	const node = createElementNode(type)
	Object.assign(node.props, props)
	return node
}

function withText(node: ElementNode, text: string): ElementNode {
	insertNode(node, createFallbackTextNode(text))
	return node
}

function render(root: ElementNode, width = 10, height = 4): Screen {
	const screen = new Screen(width, height)
	layoutTree(root, width, height)
	paintTree(root, screen)
	return screen
}

describe("行内节点：样式折叠", () => {
	test("span 的 style 只作用于自身文本", () => {
		const text = el("text")
		insertNode(text, withText(el("span", { style: { fg: "#ff0000" } }), "A"))
		withText(text, "B")
		const root = el("root")
		insertNode(root, text)

		const screen = render(root)
		expect(screen.snapshot()[0]).toBe("AB        ")
		const spans = captureSpans(screen).lines[0]?.spans ?? []
		expect(spans[0]?.text).toBe("A")
		expect(spans[0]?.fg).toBe("#ff0000")
		// 尾部空白与 "B" 同样式，合并进同一段
		expect(spans[1]?.text.startsWith("B")).toBe(true)
		expect(spans[1]?.fg).toBeUndefined()
	})

	test("b/strong 折叠为 bold 属性", () => {
		const text = el("text")
		insertNode(text, withText(el("b"), "X"))
		const root = el("root")
		insertNode(root, text)

		const spans = captureSpans(render(root)).lines[0]?.spans ?? []
		expect(spans[0]?.attributes).toEqual(["bold"])
	})

	test("嵌套 b > i 叠加 bold + italic", () => {
		const text = el("text")
		const bold = el("b")
		insertNode(bold, withText(el("i"), "Y"))
		insertNode(text, bold)
		const root = el("root")
		insertNode(root, text)

		const spans = captureSpans(render(root)).lines[0]?.spans ?? []
		expect(spans[0]?.attributes).toEqual(["bold", "italic"])
	})

	test("父 text 样式被行内节点继承", () => {
		const text = el("text", { style: { fg: "#0000ff" } })
		insertNode(text, withText(el("u"), "Z"))
		const root = el("root")
		insertNode(root, text)

		const spans = captureSpans(render(root)).lines[0]?.spans ?? []
		expect(spans[0]?.fg).toBe("#0000ff")
		expect(spans[0]?.attributes).toEqual(["underline"])
	})
})

describe("行内节点：br 与布局", () => {
	test("br 强制换行并参与高度计算", () => {
		const text = el("text")
		withText(text, "AB")
		insertNode(text, el("br"))
		withText(text, "CD")
		const root = el("root")
		insertNode(root, text)

		const screen = render(root)
		expect(screen.snapshot()[0]?.trimEnd()).toBe("AB")
		expect(screen.snapshot()[1]?.trimEnd()).toBe("CD")
		expect(text.contentHeight).toBe(2)
	})

	test("行内文本参与换行宽度（超宽折行）", () => {
		const text = el("text")
		insertNode(text, withText(el("span"), "ABCDE"))
		withText(text, "FGH")
		const root = el("root")
		insertNode(root, text)

		const screen = render(root, 4, 4)
		expect(screen.snapshot()[0]?.trimEnd()).toBe("ABCD")
		expect(screen.snapshot()[1]?.trimEnd()).toBe("EFGH")
	})
})

describe("scrollbox：stickyScroll", () => {
	function build(count: number): { root: ElementNode; scrollbox: ElementNode } {
		const scrollbox = el("scrollbox", { height: 3, stickyScroll: true, stickyStart: "bottom" })
		for (let i = 0; i < count; i++) {
			insertNode(scrollbox, withText(el("text", { height: 1 }), `L${i}`))
		}
		const root = el("root")
		insertNode(root, scrollbox)
		return { root, scrollbox }
	}

	test("首帧贴底", () => {
		const { root, scrollbox } = build(10)
		layoutTree(root, 10, 3)
		expect(scrollbox.contentHeight).toBe(10)
		expect(scrollbox.scrollTop).toBe(7)
	})

	test("内容增长时继续贴底", () => {
		const { root, scrollbox } = build(10)
		layoutTree(root, 10, 3)
		insertNode(scrollbox, withText(el("text", { height: 1 }), "L10"))
		insertNode(scrollbox, withText(el("text", { height: 1 }), "L11"))
		layoutTree(root, 10, 3)
		expect(scrollbox.scrollTop).toBe(9)
	})

	test("用户手动滚离底部后不再跟随", () => {
		const { root, scrollbox } = build(10)
		layoutTree(root, 10, 3)
		scrollbox.props.scrollTop = 2
		layoutTree(root, 10, 3)
		expect(scrollbox.scrollTop).toBe(2)

		insertNode(scrollbox, withText(el("text", { height: 1 }), "L10"))
		layoutTree(root, 10, 3)
		expect(scrollbox.scrollTop).toBe(2)
	})

	test("非 sticky 时按 requested 收敛", () => {
		const { root, scrollbox } = build(10)
		scrollbox.props.stickyScroll = false
		scrollbox.props.scrollTop = 4
		layoutTree(root, 10, 3)
		expect(scrollbox.scrollTop).toBe(4)
	})
})
