/** @jsxImportSource #fallback-solid */
import { describe, expect, test } from "bun:test"
import { createComponent } from "solid-js"
import { FallbackRenderer, MemoryBackend } from "../terminal"
import { flushSync, renderRoot } from "./renderer"
import { Textarea, type TextareaApi } from "./components"
import { createChatBridge, type ChatClientLike } from "../chat-bridge"

/**
 * 代码审查回归测试：opentui 替换全链路审查（2026-08-26）发现的缺陷修复验证。
 */

describe("审查修复：ScrollBox 视口裁剪", () => {
	test("内容超出视口时不溢出覆盖后续兄弟元素", () => {
		const backend = new MemoryBackend(24, 6)
		const renderer = new FallbackRenderer(backend)
		renderer.start()
		const dispose = renderRoot(
			() =>
				createComponent(
					() => (
						<box flex>
							<box height={1}>
								<text>header</text>
							</box>
							<scrollbox height={2}>
								<text>item-one</text>
								<text>item-two</text>
								<text>item-three-overflow</text>
							</scrollbox>
							<text>below</text>
						</box>
					),
					{},
				),
			renderer,
		)
		flushSync()
		const snap = renderer.currentScreen.snapshot()
		// scrollbox 视口 2 行（y1..y2），第三项必须被裁剪；
		// 修复前 item-three-overflow 溢出绘制到 y3 覆盖 below 的右侧
		expect(snap[1]!.trim()).toBe("item-one")
		expect(snap[2]!.trim()).toBe("item-two")
		expect(snap[3]!.trim()).toBe("below")
		expect(snap[3]!).not.toContain("overflow")
		dispose()
	})
})

describe("审查修复：代理对光标计算", () => {
	test("emoji 后光标落在完整字符之后（不劈代理对）", () => {
		const backend = new MemoryBackend(20, 5)
		const renderer = new FallbackRenderer(backend)
		renderer.start()
		let input: TextareaApi | undefined
		const dispose = renderRoot(
			() =>
				createComponent(
					() => (
						<box flex>
							<Textarea
								height={2}
								ref={(api) => {
									input = api
								}}
							/>
						</box>
					),
					{},
				),
			renderer,
		)
		flushSync()
		input!.handleKey({ type: "text", text: "😀" })
		flushSync()
		// emoji 占 2 列（col0..1），光标必须在 col2（完整字符之后）
		// 修复前 UTF-16 slice 劈开代理对：光标落在 col1 且写入半个代理
		expect(renderer.currentScreen.cellAt(2, 0).style.reverse).toBe(true)
		expect(renderer.currentScreen.cellAt(1, 0).ch).toBe("") // 占位格仍是完整 emoji 的后半
		expect(renderer.currentScreen.cellAt(0, 0).ch).toBe("😀")
		// end 键：code point 口径行尾（col 1），不越界到 UTF-16 长度 2
		expect(input!.handleKey({ type: "end" })).toBe(true)
		input!.handleKey({ type: "text", text: "b" })
		expect(input!.getText()).toBe("😀b")
		dispose()
	})
})

describe("审查修复：多行文本插入", () => {
	test("含换行的 text 键入拆分为多行（不再压平）", () => {
		const backend = new MemoryBackend(20, 5)
		const renderer = new FallbackRenderer(backend)
		renderer.start()
		let input: TextareaApi | undefined
		const dispose = renderRoot(
			() =>
				createComponent(
					() => (
						<box flex>
							<Textarea
								height={3}
								ref={(api) => {
									input = api
								}}
							/>
						</box>
					),
					{},
				),
			renderer,
		)
		flushSync()
		expect(input!.handleKey({ type: "text", text: "a\nb" })).toBe(true)
		expect(input!.getText()).toBe("a\nb")
		// 行首插入多行：光标后内容（b）跟在末段之后——标准编辑器语义
		expect(input!.handleKey({ type: "home" })).toBe(true)
		expect(input!.handleKey({ type: "down" })).toBe(true)
		expect(input!.handleKey({ type: "text", text: "x\ny" })).toBe(true)
		expect(input!.getText()).toBe("a\nx\nyb")
		dispose()
	})
})

describe("审查修复：会话创建并发去重", () => {
	test("连发两条消息只创建一个会话", async () => {
		let createCalls = 0
		const prompts: Array<{ sessionID: string }> = []
		const client: ChatClientLike = {
			session: {
				create: async () => {
					createCalls += 1
					await new Promise((r) => setTimeout(r, 15))
					return { data: { id: "sess-race" } }
				},
				prompt: async (input) => {
					prompts.push({ sessionID: input.sessionID })
					return {}
				},
			},
		}
		const events = {
			subscribe: async () => () => {},
		}
		const bridge = await createChatBridge({
			url: "http://test",
			events: events as never,
			directory: "/tmp",
			clientOverride: client,
		})
		bridge.send("first")
		bridge.send("second")
		await new Promise((r) => setTimeout(r, 40))
		expect(createCalls).toBe(1)
		expect(prompts).toEqual([
			{ sessionID: "sess-race" },
			{ sessionID: "sess-race" },
		])
		bridge.dispose()
	})
})
