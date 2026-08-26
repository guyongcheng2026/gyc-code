/** @jsxImportSource #fallback-solid */
import { describe, expect, test } from "bun:test"
import { createComponent } from "solid-js"
import { FallbackRenderer, MemoryBackend } from "../terminal"
import { flushSync, renderRoot } from "./renderer"
import { Textarea, type TextareaApi } from "./components"
import { createChatBridge, type ChatClientLike } from "../chat-bridge"

/**
 * S1 slice 2：resize 无闪帧、光标可见性、会话引擎桥。
 */

function setup(w = 20, h = 10): { renderer: FallbackRenderer; backend: MemoryBackend } {
	const backend = new MemoryBackend(w, h)
	const renderer = new FallbackRenderer(backend)
	renderer.start()
	return { renderer, backend }
}

describe("S1 slice2 resize 重布局", () => {
	test("resize 后同步输出新布局（无旧布局中间帧）", () => {
		const { renderer, backend } = setup(20, 10)
		const dispose = renderRoot(
			() =>
				createComponent(() => (
					<box flex>
						<box height={1}>
							<text>header</text>
						</box>
						<scrollbox flex>
							<text>body-content</text>
						</scrollbox>
						<box height={1}>
							<text>footer</text>
						</box>
					</box>
				), {}),
			renderer,
		)
		flushSync()
		// resize 到更宽：header 应仍在新第 0 行（钩子同步重布局后输出）
		backend.emitResize(40, 12)
		const snap = renderer.currentScreen.snapshot()
		expect(snap[0]!.trim()).toBe("header")
		expect(snap[1]!.trim()).toBe("body-content")
		expect(snap[11]!.trim()).toBe("footer")
		// 输出流的最后一帧是 resize 后的全量帧（含 footer 定位序列）
		expect(backend.output).toContain("\x1b[12;1H")
		dispose()
	})
})

describe("S1 slice2 光标可见性", () => {
	test("cursorVisible=false 时光标格不反白", () => {
		const { renderer } = setup()
		let input: TextareaApi | undefined
		const dispose = renderRoot(
			() =>
				createComponent(
					() => (
						<box flex>
							<Textarea
								height={2}
								cursorVisible={false}
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
		input!.handleKey({ type: "text", text: "ab" })
		flushSync()
		const cell = renderer.currentScreen.cellAt(0, 0)
		expect(cell.ch).toBe("a")
		expect(cell.style.reverse).toBeUndefined()
		dispose()
	})

	test("cursorVisible 默认时光标反白", () => {
		const { renderer } = setup()
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
		input!.handleKey({ type: "text", text: "ab" })
		flushSync()
		// 光标在 col 2（"ab" 之后）：反白空格
		const cursorCell = renderer.currentScreen.cellAt(2, 0)
		expect(cursorCell.style.reverse).toBe(true)
		dispose()
	})
})

describe("S1 slice2 会话引擎桥", () => {
	function fakeClient(): { client: ChatClientLike; prompts: Array<{ sessionID: string; text: string }> } {
		const prompts: Array<{ sessionID: string; text: string }> = []
		const client: ChatClientLike = {
			session: {
				create: async () => ({ data: { id: "sess-1" } }),
				prompt: async (input) => {
					prompts.push({ sessionID: input.sessionID, text: input.parts[0]?.text ?? "" })
					return {}
				},
			},
		}
		return { client, prompts }
	}

	function fakeEvents(): {
		events: { subscribe: (h: (e: unknown) => void) => Promise<() => void> }
		emit: (e: unknown) => void
	} {
		let handler: ((e: unknown) => void) | undefined
		return {
			events: {
				subscribe: async (h) => {
					handler = h
					return () => {
						handler = undefined
					}
				},
			},
			emit: (e) => handler?.(e),
		}
	}

	test("send 首次创建会话并发送 prompt", async () => {
		const { client, prompts } = fakeClient()
		const { events, emit } = fakeEvents()
		const bridge = await createChatBridge({
			url: "http://test",
			events: events as never,
			directory: "/tmp",
			clientOverride: client,
		})
		bridge.send("你好")
		await new Promise((r) => setTimeout(r, 10))
		expect(prompts).toEqual([{ sessionID: "sess-1", text: "你好" }])
		bridge.dispose()
	})

	test("message.part.updated 事件按 partID upsert 行", async () => {
		const { client } = fakeClient()
		const { events, emit } = fakeEvents()
		const bridge = await createChatBridge({
			url: "http://test",
			events: events as never,
			directory: "/tmp",
			clientOverride: client,
		})
		// 先发一条消息建立 sessionID
		bridge.send("q")
		await new Promise((r) => setTimeout(r, 10))
		// assistant text part 流式累计
		emit({
			type: "message.updated",
			properties: { sessionID: "sess-1", info: { id: "m-a", role: "assistant" } },
		})
		emit({
			type: "message.part.updated",
			properties: {
				sessionID: "sess-1",
				part: { id: "p-1", sessionID: "sess-1", messageID: "m-a", type: "text", text: "回复前半" },
			},
		})
		expect(bridge.rows().length).toBe(1)
		expect(bridge.rows()[0]!.text).toBe("回复前半")
		emit({
			type: "message.part.updated",
			properties: {
				sessionID: "sess-1",
				part: { id: "p-1", sessionID: "sess-1", messageID: "m-a", type: "text", text: "回复前半+后半" },
			},
		})
		expect(bridge.rows().length).toBe(1)
		expect(bridge.rows()[0]!.text).toBe("回复前半+后半")
		bridge.dispose()
	})

	test("user 消息的 part 不入流（本地已回显）", async () => {
		const { client } = fakeClient()
		const { events, emit } = fakeEvents()
		const bridge = await createChatBridge({
			url: "http://test",
			events: events as never,
			directory: "/tmp",
			clientOverride: client,
		})
		emit({
			type: "message.updated",
			properties: { sessionID: "sess-1", info: { id: "m-u", role: "user" } },
		})
		emit({
			type: "message.part.updated",
			properties: {
				sessionID: "sess-1",
				part: { id: "p-u", sessionID: "sess-1", messageID: "m-u", type: "text", text: "用户消息" },
			},
		})
		expect(bridge.rows().length).toBe(0)
		bridge.dispose()
	})

	test("tool part 以工具行呈现", async () => {
		const { client } = fakeClient()
		const { events, emit } = fakeEvents()
		const bridge = await createChatBridge({
			url: "http://test",
			events: events as never,
			directory: "/tmp",
			clientOverride: client,
		})
		emit({
			type: "message.part.updated",
			properties: {
				sessionID: "sess-1",
				part: {
					id: "p-t",
					sessionID: "sess-1",
					messageID: "m-a",
					type: "tool",
					callID: "c1",
					tool: "read",
					state: { type: "running" },
				},
			},
		})
		const row = bridge.rows()[0]!
		expect(row.kind).toBe("tool")
		expect(row.text).toContain("read")
		expect(row.text).toContain("running")
		bridge.dispose()
	})
})
