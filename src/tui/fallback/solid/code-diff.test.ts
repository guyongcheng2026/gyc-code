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

function render(root: ElementNode, width = 40, height = 8): Screen {
	const screen = new Screen(width, height)
	layoutTree(root, width, height)
	paintTree(root, screen)
	return screen
}

describe("code 渲染", () => {
	test("按 filetype 高亮关键字", () => {
		const code = el("code", { content: "const a = 1", filetype: "ts", height: 1 })
		const root = el("root")
		insertNode(root, code)
		const screen = render(root)
		expect(screen.snapshot()[0]?.trimEnd()).toBe("const a = 1")

		const spans = captureSpans(screen).lines[0]?.spans ?? []
		const keyword = spans.find((span) => span.text.includes("const"))
		expect(keyword?.fg).toBe("#d73a49")
	})

	test("多行内容按行渲染并计入高度", () => {
		const code = el("code", { content: "a\nb\nc", filetype: "ts" })
		const root = el("root")
		insertNode(root, code)
		const screen = render(root)
		expect(screen.snapshot().slice(0, 3).map((line) => line.trimEnd())).toEqual(["a", "b", "c"])
		expect(code.contentHeight).toBe(3)
	})

	test("超宽行折行", () => {
		const code = el("code", { content: "abcdefgh", filetype: "ts" })
		const root = el("root")
		insertNode(root, code)
		const screen = render(root, 4, 4)
		expect(screen.snapshot()[0]?.trimEnd()).toBe("abcd")
		expect(screen.snapshot()[1]?.trimEnd()).toBe("efgh")
	})
})

describe("diff 渲染", () => {
	test("+/-/上下文行使用不同前景色", () => {
		const diff = el("diff", { diff: "@@ -1,1 +1,1 @@\n context\n+added\n-removed" })
		const root = el("root")
		insertNode(root, diff)
		const screen = render(root)

		const lines = captureSpans(screen).lines
		const added = lines[2]?.spans.find((span) => span.text.includes("added"))
		const removed = lines[3]?.spans.find((span) => span.text.includes("removed"))
		expect(added?.fg).toBe("#22863a")
		expect(removed?.fg).toBe("#cb2431")
	})

	test("showLineNumbers 输出旧/新双列行号", () => {
		const diff = el("diff", { diff: "@@ -1,2 +1,3 @@\n context\n+added", showLineNumbers: true })
		const root = el("root")
		insertNode(root, diff)
		const screen = render(root, 40, 5)
		// 上下文行：旧 1 / 新 1
		expect(screen.snapshot()[1]).toContain("   1    1 ")
		// 新增行：旧列留空，新 2
		expect(screen.snapshot()[2]).toContain("        2 +added")
	})

	test("hunk 头使用高亮样式", () => {
		const diff = el("diff", { diff: "@@ -1,1 +1,1 @@" })
		const root = el("root")
		insertNode(root, diff)
		const screen = render(root)
		const span = captureSpans(screen).lines[0]?.spans[0]
		expect(span?.attributes).toEqual(["bold"])
		expect(span?.fg).toBe("#005cc5")
	})
})

describe("scrollbox 滚动条", () => {
	function build(visible: boolean): ElementNode {
		const scrollbox = el("scrollbox", {
			height: 3,
			width: 6,
			verticalScrollbarOptions: { visible },
		})
		for (let i = 0; i < 10; i++) {
			const line = el("text", { height: 1 })
			insertNode(line, createFallbackTextNode(`L${i}`))
			insertNode(scrollbox, line)
		}
		const root = el("root")
		insertNode(root, scrollbox)
		return root
	}

	test("visible=true 时最右列绘制滑块与轨道", () => {
		const root = build(true)
		const screen = render(root, 6, 3)
		const column = screen.snapshot().map((line) => line[5])
		expect(column.every((ch) => ch === "█" || ch === "│")).toBe(true)
		expect(column.includes("█")).toBe(true)
	})

	test("visible=false 时不绘制滚动条", () => {
		const root = build(false)
		const screen = render(root, 6, 3)
		expect(screen.snapshot().every((line) => !line.includes("█"))).toBe(true)
	})
})
