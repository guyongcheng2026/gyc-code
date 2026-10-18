import { describe, expect, test } from "bun:test"
import { Screen } from "../screen"
import { createElementNode, createFallbackTextNode, insertNode, type ElementNode } from "./nodes"
import { layoutTree, paintTree } from "./paint"

/** 构造一个带文本内容的 box。 */
function textBox(text: string, props: Record<string, unknown> = {}): ElementNode {
	const box = createElementNode("box")
	Object.assign(box.props, props)
	const label = createElementNode("text")
	insertNode(label, createFallbackTextNode(text))
	insertNode(box, label)
	return box
}

function render(children: ElementNode[], width = 8, height = 3): string[] {
	const root = createElementNode("root")
	for (const child of children) insertNode(root, child)
	const screen = new Screen(width, height)
	layoutTree(root, width, height)
	paintTree(root, screen)
	return screen.snapshot()
}

describe("绘制层：zIndex", () => {
	test("zIndex 大者后绘制，覆盖先绘制的同级元素", () => {
		const low = textBox("BBB", { position: "absolute", top: 0, left: 0, width: 3, height: 1, zIndex: 0 })
		const high = textBox("AAA", { position: "absolute", top: 0, left: 0, width: 3, height: 1, zIndex: 1 })
		// 树的顺序是 low 在前；靠 zIndex 让 high 后画
		expect(render([low, high])[0]).toBe("AAA     ")
	})

	test("无 zIndex 时按树序绘制（后插入覆盖）", () => {
		const first = textBox("BBB", { position: "absolute", top: 0, left: 0, width: 3, height: 1 })
		const second = textBox("AAA", { position: "absolute", top: 0, left: 0, width: 3, height: 1 })
		expect(render([first, second])[0]).toBe("AAA     ")
	})

	test("zIndex 为负数的元素先绘制", () => {
		const back = textBox("BBB", { position: "absolute", top: 0, left: 0, width: 3, height: 1, zIndex: -1 })
		const front = textBox("AAA", { position: "absolute", top: 0, left: 0, width: 3, height: 1 })
		expect(render([front, back])[0]).toBe("AAA     ")
	})
})

describe("绘制层：visible", () => {
	test("visible=false 的元素不绘制但仍占位", () => {
		const hidden = textBox("XXX", { height: 1, visible: false })
		const shown = textBox("OK", { height: 1 })
		const lines = render([hidden, shown])
		// 隐藏元素仍占第一行（布局不跳过），但不绘制内容
		expect(lines[0]).toBe("        ")
		expect(lines[1]).toBe("OK      ")
	})
})
