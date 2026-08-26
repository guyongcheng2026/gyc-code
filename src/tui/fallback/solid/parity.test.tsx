/** @jsxImportSource #fallback-solid */
import { describe, expect, test } from "bun:test"
import { createComponent } from "solid-js"
import { FallbackRenderer, MemoryBackend } from "../terminal"
import { flushSync, renderRoot } from "./renderer"
import { Box, Markdown, Text } from "./components"
import { parseMarkdown } from "../markdown"

/**
 * parity slice A：布局增强（row/border/padding/gap）、富文本 spans、
 * Markdown 渲染的功能平价测试。
 */

function mount(renderer: FallbackRenderer, app: () => unknown): () => void {
	return renderRoot(() => createComponent(app as () => never, {}), renderer)
}

describe("parity：row 布局", () => {
	test("子元素横向排列", () => {
		const backend = new MemoryBackend(30, 4)
		const renderer = new FallbackRenderer(backend)
		renderer.start()
		const dispose = mount(renderer, () => (
			<box flex direction="row">
				<text>左</text>
				<text>右</text>
			</box>
		))
		flushSync()
		const snap = renderer.currentScreen.snapshot()
		expect(snap[0]!.startsWith("左右")).toBe(true)
		dispose()
	})

	test("gap 横向间距", () => {
		const backend = new MemoryBackend(30, 4)
		const renderer = new FallbackRenderer(backend)
		renderer.start()
		const dispose = mount(renderer, () => (
			<box flex direction="row" gap={2}>
				<text>ab</text>
				<text>cd</text>
			</box>
		))
		flushSync()
		const snap = renderer.currentScreen.snapshot()
		expect(snap[0]!.startsWith("ab  cd")).toBe(true)
		dispose()
	})

	test("flex 子瓜分剩余宽度", () => {
		const backend = new MemoryBackend(30, 4)
		const renderer = new FallbackRenderer(backend)
		renderer.start()
		const dispose = mount(renderer, () => (
			<box flex direction="row">
				<text>[</text>
				<box flex style={{ bg: "#112233" }} />
				<text>]</text>
			</box>
		))
		flushSync()
		const snap = renderer.currentScreen.snapshot()
		// [ 在 col0，] 在 col29，中间全是 bg
		expect(snap[0]![0]).toBe("[")
		expect(snap[0]![29]).toBe("]")
		expect(renderer.currentScreen.cellAt(15, 0).style.bg).toBe("#112233")
		dispose()
	})
})

describe("parity：border 与 padding", () => {
	test("single 边框绘制且内容内缩", () => {
		const backend = new MemoryBackend(20, 6)
		const renderer = new FallbackRenderer(backend)
		renderer.start()
		const dispose = mount(renderer, () => (
			<box flex border>
				<text>内容</text>
			</box>
		))
		flushSync()
		const snap = renderer.currentScreen.snapshot()
		expect(snap[0]!.startsWith("┌──────")).toBe(true)
		expect(snap[1]![0]).toBe("│")
		expect(snap[1]!.slice(1, 3)).toBe("内容")
		expect(snap[5]!.startsWith("└──────")).toBe(true)
		dispose()
	})

	test("double 边框", () => {
		const backend = new MemoryBackend(20, 6)
		const renderer = new FallbackRenderer(backend)
		renderer.start()
		const dispose = mount(renderer, () => (
			<box flex border="double">
				<text>x</text>
			</box>
		))
		flushSync()
		expect(renderer.currentScreen.snapshot()[0]![0]).toBe("╔")
		dispose()
	})

	test("padding 内缩", () => {
		const backend = new MemoryBackend(20, 6)
		const renderer = new FallbackRenderer(backend)
		renderer.start()
		const dispose = mount(renderer, () => (
			<box flex padding={2}>
				<text>pad</text>
			</box>
		))
		flushSync()
		const snap = renderer.currentScreen.snapshot()
		expect(snap[2]!.startsWith("  pad")).toBe(true)
		dispose()
	})

	test("column gap 纵向间距", () => {
		const backend = new MemoryBackend(20, 8)
		const renderer = new FallbackRenderer(backend)
		renderer.start()
		const dispose = mount(renderer, () => (
			<box flex gap={1}>
				<text>a</text>
				<text>b</text>
			</box>
		))
		flushSync()
		const snap = renderer.currentScreen.snapshot()
		expect(snap[0]!.trim()).toBe("a")
		expect(snap[1]!.trim()).toBe("")
		expect(snap[2]!.trim()).toBe("b")
		dispose()
	})
})

describe("parity：富文本 spans", () => {
	test("行内多段样式渲染", () => {
		const backend = new MemoryBackend(30, 3)
		const renderer = new FallbackRenderer(backend)
		renderer.start()
		const dispose = mount(renderer, () => (
			<box flex>
				<Text
					spans={[
						{ text: "普通", style: {} },
						{ text: "粗", style: { bold: true } },
						{ text: "绿", style: { fg: "#00ff00" } },
					]}
				/>
			</box>
		))
		flushSync()
		const screen = renderer.currentScreen
		expect(screen.snapshot()[0]!.startsWith("普通粗绿")).toBe(true)
		// 中文宽字符全占 2 格：「普通」col0-3、「粗」col4-5、「绿」col6-7
		expect(screen.cellAt(4, 0).style.bold).toBe(true)
		expect(screen.cellAt(6, 0).style.fg).toBe("#00ff00")
		dispose()
	})

	test("富文本超宽 wrap", () => {
		const backend = new MemoryBackend(5, 3)
		const renderer = new FallbackRenderer(backend)
		renderer.start()
		const dispose = mount(renderer, () => (
			<box flex>
				<Text
					spans={[
						{ text: "aaaaa", style: { bold: true } },
						{ text: "bbbbb", style: {} },
					]}
				/>
			</box>
		))
		flushSync()
		const snap = renderer.currentScreen.snapshot()
		expect(snap[0]).toBe("aaaaa")
		expect(snap[1]).toBe("bbbbb")
		dispose()
	})

	test("样式继承：嵌套 text 继承祖先样式", () => {
		const backend = new MemoryBackend(20, 3)
		const renderer = new FallbackRenderer(backend)
		renderer.start()
		const dispose = mount(renderer, () => (
			<box flex style={{ fg: "#ff0000" }}>
				<Text>继承色</Text>
			</box>
		))
		flushSync()
		expect(renderer.currentScreen.cellAt(0, 0).style.fg).toBe("#ff0000")
		dispose()
	})
})

describe("parity：Markdown 渲染", () => {
	test("解析：标题/列表/引用/代码块/行内标记", () => {
		const lines = parseMarkdown(
			[
				"# 标题一",
				"",
				"普通 **粗** *斜* `码` ~~删~~",
				"- 列表项",
				"> 引用行",
				"```ts",
				"const a = 1",
				"```",
			].join("\n"),
		)
		expect(lines[0]![0]!.style.bold).toBe(true)
		// 行内：粗/斜/码/删 四段 + 普通前缀
		const inline = lines[2]!
		expect(inline.some((s) => s.text === "粗" && s.style.bold)).toBe(true)
		expect(inline.some((s) => s.text === "斜" && s.style.italic)).toBe(true)
		expect(inline.some((s) => s.text === "码" && s.style.fg === "#22863a")).toBe(true)
		expect(inline.some((s) => s.text === "删" && s.style.strikethrough)).toBe(true)
		// 列表前缀
		expect(lines[3]![0]!.text).toBe("  • ")
		// 引用
		expect(lines[4]![0]!.text).toBe("│ ")
		// 代码块 fence
		expect(lines[5]![0]!.text).toBe("┌ ts")
		expect(lines[6]![1]!.text).toBe("const a = 1")
		expect(lines[7]![0]!.text).toBe("└")
	})

	test("组件端到端：Markdown 渲染到网格", () => {
		const backend = new MemoryBackend(30, 8)
		const renderer = new FallbackRenderer(backend)
		renderer.start()
		const dispose = mount(renderer, () => (
			<box flex>
				<Markdown source={"# 标题\n\n- **项**"} />
			</box>
		))
		flushSync()
		const snap = renderer.currentScreen.snapshot()
		expect(snap[0]!.startsWith("标题")).toBe(true)
		// 空行（解析输出的 [] 行）占据第 1 行
		expect(snap[1]!.trim()).toBe("")
		expect(snap[2]!.startsWith("  • 项")).toBe(true)
		// 粗体生效（「  • 」占 col0-3，「项」主格在 col4）
		expect(renderer.currentScreen.cellAt(4, 2).style.bold).toBe(true)
		dispose()
	})

	test("Box 组件透传 direction/gap/border", () => {
		const backend = new MemoryBackend(20, 5)
		const renderer = new FallbackRenderer(backend)
		renderer.start()
		const dispose = mount(renderer, () => (
			<Box flex direction="row" gap={1} border>
				<Text>a</Text>
				<Text>b</Text>
			</Box>
		))
		flushSync()
		const snap = renderer.currentScreen.snapshot()
		expect(snap[0]![0]).toBe("┌")
		expect(snap[1]!.startsWith("│a b")).toBe(true)
		dispose()
	})
})
