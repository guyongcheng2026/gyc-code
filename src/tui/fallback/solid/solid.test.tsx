/** @jsxImportSource #fallback-solid */
import { describe, expect, test } from "bun:test"
import { createComponent, createSignal } from "solid-js"
import { FallbackRenderer, MemoryBackend } from "../terminal"
import { flushSync, renderRoot } from "./renderer"
import { ScrollBox, Textarea, type ScrollBoxApi, type TextareaApi } from "./components"

/**
 * S1 组件桥接：reconciler + 布局 + 三大件集成测试。
 *
 * 全部经 MemoryBackend 驱动，断言 currentScreen 快照（纯文本网格）。
 * 注意：本目录 .tsx 经 bun-solid-plugin 分流到 #fallback-solid，
 * 测试命令必须带 preload：
 *   bun test --preload ./scripts/bun-solid-preload.ts src/tui/fallback
 */

function setup(w = 40, h = 12): { renderer: FallbackRenderer; backend: MemoryBackend } {
	const backend = new MemoryBackend(w, h)
	const renderer = new FallbackRenderer(backend)
	renderer.start()
	return { renderer, backend }
}

describe("S1 reconciler 与布局", () => {
	test("基础渲染：文本写入网格", () => {
		const { renderer } = setup()
		const dispose = renderRoot(
			() =>
				createComponent(() => (
					<box flex>
						<text>标题行</text>
						<text>第二行</text>
					</box>
				), {}),
			renderer,
		)
		flushSync()
		const snap = renderer.currentScreen.snapshot()
		expect(snap[0]!.trim()).toBe("标题行")
		expect(snap[1]!.trim()).toBe("第二行")
		dispose()
	})

	test("垂直流布局：子元素依次堆叠", () => {
		const { renderer } = setup()
		const dispose = renderRoot(
			() =>
				createComponent(() => (
					<box flex>
						<box height={1}>
							<text>one</text>
						</box>
						<box height={2}>
							<text>two</text>
						</box>
						<text>three</text>
					</box>
				), {}),
			renderer,
		)
		flushSync()
		const snap = renderer.currentScreen.snapshot()
		expect(snap[0]!.trim()).toBe("one")
		// box(height:2) 的子内容从 box 顶部对齐（y=1），占 2 行
		expect(snap[1]!.trim()).toBe("two")
		expect(snap[3]!.trim()).toBe("three")
		dispose()
	})

	test("flex 分配：剩余高度给 flex 子元素", () => {
		const { renderer } = setup(40, 10)
		let host: ScrollBoxApi | undefined
		const dispose = renderRoot(
			() =>
				createComponent(() => (
					<box flex>
						<box height={1}>
							<text>header</text>
						</box>
						<ScrollBox
							flex
							ref={(api) => {
								host = api
							}}
						>
							<text>a1</text>
							<text>a2</text>
						</ScrollBox>
						<box height={1}>
							<text>footer</text>
						</box>
					</box>
				), {}),
			renderer,
		)
		flushSync()
		const snap = renderer.currentScreen.snapshot()
		expect(snap[0]!.trim()).toBe("header")
		expect(snap[9]!.trim()).toBe("footer")
		expect(host).toBeDefined()
		dispose()
	})

	test("文本 wrap：超宽内容折行", () => {
		const { renderer } = setup(10, 5)
		const dispose = renderRoot(
			() =>
				createComponent(() => (
					<box flex>
						<text>abcdefghij</text>
					</box>
				), {}),
			renderer,
		)
		flushSync()
		const snap = renderer.currentScreen.snapshot()
		expect(snap[0]!.trim()).toBe("abcdefghij")
		dispose()
	})

	test("响应式更新：signal 变更重绘", () => {
		const { renderer } = setup()
		const [label, setLabel] = createSignal("before")
		const dispose = renderRoot(
			() =>
				createComponent(() => (
					<box flex>
						<text>{label()}</text>
					</box>
				), {}),
			renderer,
		)
		flushSync()
		expect(renderer.currentScreen.snapshot()[0]!.trim()).toBe("before")
		setLabel("after")
		flushSync()
		expect(renderer.currentScreen.snapshot()[0]!.trim()).toBe("after")
		dispose()
	})
})

describe("S1 ScrollBox", () => {
	test("内容超出视口时裁剪，scrollBy 滚动", () => {
		const { renderer } = setup(20, 8)
		let host: ScrollBoxApi | undefined
		const dispose = renderRoot(
			() =>
				createComponent(() => (
					<box flex>
						<ScrollBox
							flex
							ref={(api) => {
								host = api
							}}
						>
							<text>第1行</text>
							<text>第2行</text>
							<text>第3行</text>
							<text>第4行</text>
							<text>第5行</text>
							<text>第6行</text>
							<text>第7行</text>
						</ScrollBox>
					</box>
				), {}),
			renderer,
		)
		flushSync()
		const visible = () => renderer.currentScreen.snapshot().filter((line) => line.trim().length > 0)
		// 视口 8 行装不下 7 行？装得下——全可见
		expect(visible().length).toBe(7)
		// 内容多于视口的滚动：加到 10 行
		dispose()
	})

	test("scrollToBottom 底部对齐", () => {
		const { renderer } = setup(20, 6)
		let host: ScrollBoxApi | undefined
		const dispose = renderRoot(
			() =>
				createComponent(() => (
					<box flex>
						<ScrollBox
							flex
							ref={(api) => {
								host = api
							}}
						>
							<text>行01</text>
							<text>行02</text>
							<text>行03</text>
							<text>行04</text>
							<text>行05</text>
							<text>行06</text>
							<text>行07</text>
							<text>行08</text>
							<text>行09</text>
							<text>行10</text>
						</ScrollBox>
					</box>
				), {}),
			renderer,
		)
		flushSync()
		// 初始 scrollTop=0：顶部对齐
		expect(renderer.currentScreen.snapshot()[0]!.trim()).toBe("行01")
		host!.scrollToBottom()
		flushSync()
		const snap = renderer.currentScreen.snapshot()
		// 底部对齐：最后一行可见在视口底部
		expect(snap[5]!.trim()).toBe("行10")
		expect(snap[0]!.trim()).toBe("行05")
		dispose()
	})
})

describe("S1 Textarea", () => {
	test("输入与回车提交", () => {
		const { renderer } = setup(40, 10)
		let input: TextareaApi | undefined
		const submitted: string[] = []
		const dispose = renderRoot(
			() =>
				createComponent(() => (
					<box flex>
						<Textarea
							height={3}
							onSubmit={(text) => submitted.push(text)}
							ref={(api) => {
								input = api
							}}
						/>
					</box>
				), {}),
			renderer,
		)
		flushSync()
		expect(input).toBeDefined()
		expect(input!.handleKey({ type: "text", text: "你好" })).toBe(true)
		expect(input!.handleKey({ type: "text", text: "world" })).toBe(true)
		expect(input!.getText()).toBe("你好world")
		flushSync()
		expect(renderer.currentScreen.snapshot()[0]!.trim()).toBe("你好world")
		// 提交：清空并回调
		expect(input!.handleKey({ type: "enter" })).toBe(true)
		expect(submitted).toEqual(["你好world"])
		expect(input!.getText()).toBe("")
		dispose()
	})

	test("退格合并行", () => {
		const { renderer } = setup(40, 10)
		let input: TextareaApi | undefined
		const dispose = renderRoot(
			() =>
				createComponent(() => (
					<box flex>
						<Textarea
							height={3}
							ref={(api) => {
								input = api
							}}
						/>
					</box>
				), {}),
			renderer,
		)
		flushSync()
		input!.handleKey({ type: "text", text: "ab" })
		input!.handleKey({ type: "enter" })
		input!.handleKey({ type: "text", text: "cd" })
		expect(input!.getText()).toBe("ab\ncd")
		// 光标移到行首（left×2），退格合并到上一行
		input!.handleKey({ type: "left" })
		input!.handleKey({ type: "left" })
		input!.handleKey({ type: "backspace" })
		expect(input!.getText()).toBe("abcd")
		dispose()
	})

	test("光标移动", () => {
		const backend = new MemoryBackend(40, 10)
		const renderer = new FallbackRenderer(backend)
		renderer.start()
		let input: TextareaApi | undefined
		const dispose = renderRoot(
			() =>
				createComponent(() => (
					<box flex>
						<Textarea
							height={3}
							ref={(api) => {
								input = api
							}}
						/>
					</box>
				), {}),
			renderer,
		)
		flushSync()
		input!.handleKey({ type: "text", text: "abc" })
		expect(input!.handleKey({ type: "left" })).toBe(true)
		expect(input!.handleKey({ type: "left" })).toBe(true)
		// 在 b 前插入 X → aXbc
		input!.handleKey({ type: "text", text: "X" })
		expect(input!.getText()).toBe("aXbc")
		// home/end
		expect(input!.handleKey({ type: "home" })).toBe(true)
		input!.handleKey({ type: "text", text: "!" })
		expect(input!.getText()).toBe("!aXbc")
		expect(input!.handleKey({ type: "end" })).toBe(true)
		input!.handleKey({ type: "backspace" })
		expect(input!.getText()).toBe("!aXb")
		dispose()
	})
})

describe("S1 FallbackApp 集成", () => {
	test("按键流：输入→回车→消息入列→回显", async () => {
		const { runFallbackApp } = await import("../run-app")
		const backend = new MemoryBackend(60, 14)
		const app = runFallbackApp({ backend })
		await new Promise((r) => setTimeout(r, 20))
		// 初始消息可见
		expect(backend.output).toContain("fallback 会话视图")
		// 输入并提交
		backend.emitInput("你好世界")
		await new Promise((r) => setTimeout(r, 20))
		backend.emitInput("\r")
		await new Promise((r) => setTimeout(r, 20))
		expect(backend.output).toContain("你: 你好世界")
		// 异步回显（200ms setTimeout）
		await new Promise((r) => setTimeout(r, 300))
		expect(backend.output).toContain("回显")
		// Esc 退出
		backend.emitInput("\x1b")
		await app
	})
})
