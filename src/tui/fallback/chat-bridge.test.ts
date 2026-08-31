import { describe, expect, test } from "bun:test"
import { createChatBridge, type ChatClientLike } from "./chat-bridge"

/** 可注入的事件订阅：测试可手动触发 handler。 */
function fakeEvents() {
	let handler: ((event: unknown) => void) | undefined
	return {
		events: {
			subscribe: async (h: (event: unknown) => void) => {
				handler = h
				return () => {
					handler = undefined
				}
			},
			emit: (event: unknown) => handler?.(event),
		},
		get handler() {
			return handler
		},
	}
}

/** wire 事件外壳（GlobalEvent = { payload }），与 event-v2-bridge 一致。 */
const wire = (payload: unknown) => ({ payload })

function makeClient(promptImpl?: ChatClientLike["v2"]["session"]["prompt"]): {
	client: ChatClientLike
	calls: Array<{ sessionID: string; prompt: { text: string } }>
} {
	const calls: Array<{ sessionID: string; prompt: { text: string } }> = []
	const client: ChatClientLike = {
		session: {
			create: async () => ({ data: { id: "ses_test" } }),
		},
		v2: {
			session: {
				prompt: promptImpl ?? (async (input) => {
					calls.push({ sessionID: input.sessionID, prompt: input.prompt })
					return { data: { id: "msg_1" } }
				}),
			},
		},
	}
	return { client, calls }
}

const textDelta = (textID: string, delta: string) =>
	wire({
		type: "session.next.text.delta",
		properties: { sessionID: "ses_test", assistantMessageID: "msg_a", textID, delta },
	})
const textEnded = (textID: string, text: string) =>
	wire({
		type: "session.next.text.ended",
		properties: { sessionID: "ses_test", assistantMessageID: "msg_a", textID, text },
	})
const partUpdated = (part: unknown) =>
	wire({
		type: "message.part.updated",
		properties: { sessionID: "ses_test", part },
	})

describe("chat-bridge 会话桥", () => {
	test("send 走 v2 session.prompt 并本地回显用户消息", async () => {
		const { client, calls } = makeClient()
		const f = fakeEvents()
		const bridge = await createChatBridge({
			url: "http://gyccode.internal",
			events: f.events,
			directory: "C:/dir",
			clientOverride: client,
		})
		bridge.send("你好")
		await new Promise((r) => setTimeout(r, 10))
		expect(calls).toEqual([{ sessionID: "ses_test", prompt: { text: "你好" } }])
		const rows = bridge.rows()
		expect(rows.some((r) => r.kind === "user" && r.text === "你好")).toBe(true)
		bridge.dispose()
	})

	test("session.next.text.delta 流式累积渲染助手消息", async () => {
		const { client } = makeClient()
		const f = fakeEvents()
		const bridge = await createChatBridge({
			url: "http://gyccode.internal",
			events: f.events,
			directory: "C:/dir",
			clientOverride: client,
		})
		f.handler?.(textDelta("t1", "你好"))
		f.handler?.(textDelta("t1", "，世"))
		const rows = bridge.rows()
		const assistant = rows.filter((r) => r.kind === "assistant")
		expect(assistant.length).toBe(1)
		expect(assistant[0]!.text).toBe("你好，世")
		bridge.dispose()
	})

	test("session.next.text.ended 渲染完整文本", async () => {
		const { client } = makeClient()
		const f = fakeEvents()
		const bridge = await createChatBridge({
			url: "http://gyccode.internal",
			events: f.events,
			directory: "C:/dir",
			clientOverride: client,
		})
		f.handler?.(textEnded("t2", "这是完整回复"))
		const rows = bridge.rows()
		expect(rows.some((r) => r.kind === "assistant" && r.text === "这是完整回复")).toBe(true)
		bridge.dispose()
	})

	test("message.part.updated 仍兼容渲染", async () => {
		const { client } = makeClient()
		const f = fakeEvents()
		const bridge = await createChatBridge({
			url: "http://gyccode.internal",
			events: f.events,
			directory: "C:/dir",
			clientOverride: client,
		})
		f.handler?.(partUpdated({ id: "p1", type: "text", text: "兼容文本", messageID: "m1", sessionID: "ses_test" }))
		const rows = bridge.rows()
		expect(rows.some((r) => r.kind === "assistant" && r.text === "兼容文本")).toBe(true)
		bridge.dispose()
	})
})
