import { createSignal } from "solid-js"
import type { Part, ToolPart } from "@gyccode/protocol/v2"

/**
 * S1 slice 2：会话引擎桥。
 *
 * 把 worker RPC（createGyccodeClient + EventSource）桥接为 fallback 视图
 * 可消费的最小会话模型：ChatRow 流 + send()。
 *
 * 事件策略（最小可用）：
 * - session.next.text.delta / .ended：v2 异步调度路径的回复事件（实测
 *   server 回复流式文本走 session.next.*，而非 message.part.updated）；
 *   delta 增量累积驱动流式观感，ended 携带完整文本兜底对齐。
 * - message.updated / message.part.updated：兼容旧事件源（部分场景仍发）。
 * - send 走 v2 session.prompt（/api/session/:id/prompt，异步调度 + 事件流）；
 *   v1 的 session.prompt 流式返回不产生异步事件，且路由在 worker 内不存在。
 */

export interface ChatRow {
	readonly id: string
	readonly label: string
	readonly text: string
	readonly kind: "user" | "assistant" | "tool" | "reasoning" | "system"
}

export interface ChatBridge {
	/** 响应式行流（Solid signal accessor） */
	rows(): readonly ChatRow[]
	/** 发送用户消息（无会话时先创建） */
	send(text: string): void
	/** 销毁：退订事件 */
	dispose(): void
}

export interface ChatBridgeOptions {
	url: string
	fetch?: typeof fetch
	headers?: RequestInit["headers"]
	/** 事件订阅源（EventSource 语义；事件为 wire GlobalEvent 或裸 Event，均兼容） */
	events: {
		subscribe: (handler: (event: unknown) => void) => Promise<() => void>
	}
	directory: string
	/** 测试注入：跳过 createGyccodeClient 直接给 client（协议兼容子集） */
	clientOverride?: ChatClientLike
}

/** ChatBridge 消费的 client 协议子集（测试可伪造）。 */
export interface ChatClientLike {
	session: {
		create: (input: { directory?: string }) => Promise<{ data?: { id: string }; error?: unknown }>
	}
	v2: {
		session: {
			prompt: (
				input: { sessionID: string; prompt: { text: string } },
				options?: { throwOnError?: boolean },
			) => Promise<unknown>
		}
	}
}

/** 事件负载的结构收窄（生成类型过宽，此处按运行时形状收窄）。 */
interface PartUpdatedEvent {
	type: "message.part.updated"
	properties: { sessionID: string; part: Part }
}
interface MessageUpdatedEvent {
	type: "message.updated"
	properties: { sessionID: string; info: { id: string; role: string } }
}
interface TextDeltaEvent {
	type: "session.next.text.delta"
	properties: { sessionID: string; assistantMessageID: string; textID: string; delta: string }
}
interface TextEndedEvent {
	type: "session.next.text.ended"
	properties: { sessionID: string; assistantMessageID: string; textID: string; text: string }
}

/** wire 事件外壳（GlobalEvent = { directory, payload }）。 */
interface WireEvent {
	payload?: unknown
}

const eventOf = (event: unknown): unknown => {
	const wire = event as WireEvent | undefined
	if (wire && typeof wire === "object" && "payload" in wire) return wire.payload
	return event
}
const isPartUpdated = (e: unknown): e is PartUpdatedEvent =>
	typeof e === "object" && e !== null && (e as PartUpdatedEvent).type === "message.part.updated" && typeof (e as PartUpdatedEvent).properties?.part === "object"
const isMessageUpdated = (e: unknown): e is MessageUpdatedEvent =>
	typeof e === "object" && e !== null && (e as MessageUpdatedEvent).type === "message.updated" && typeof (e as MessageUpdatedEvent).properties?.info?.role === "string"
const isTextDelta = (e: unknown): e is TextDeltaEvent =>
	typeof e === "object" &&
	e !== null &&
	(e as TextDeltaEvent).type === "session.next.text.delta" &&
	typeof (e as TextDeltaEvent).properties?.textID === "string" &&
	typeof (e as TextDeltaEvent).properties?.delta === "string"
const isTextEnded = (e: unknown): e is TextEndedEvent =>
	typeof e === "object" &&
	e !== null &&
	(e as TextEndedEvent).type === "session.next.text.ended" &&
	typeof (e as TextEndedEvent).properties?.textID === "string" &&
	typeof (e as TextEndedEvent).properties?.text === "string"

function partToRow(part: Part): ChatRow | undefined {
	switch (part.type) {
		case "text":
			return { id: part.id, label: "助手", text: part.text, kind: "assistant" }
		case "reasoning": {
			const head = part.text.split("\n")[0] ?? ""
			return { id: part.id, label: "思考", text: head.length > 120 ? `${head.slice(0, 120)}…` : head, kind: "reasoning" }
		}
		case "tool": {
			const tool = part as ToolPart
			const state = tool.state as { type?: string } | undefined
			return { id: part.id, label: "工具", text: `${tool.tool}${state?.type ? ` · ${state.type}` : ""}`, kind: "tool" }
		}
		default:
			return undefined
	}
}

export async function createChatBridge(options: ChatBridgeOptions): Promise<ChatBridge> {
	let client: ChatClientLike
	if (options.clientOverride) {
		client = options.clientOverride
	} else {
		const { createGyccodeClient } = await import("@gyccode/protocol/v2")
		client = createGyccodeClient({
			baseUrl: options.url,
			fetch: options.fetch,
			headers: options.headers,
		})
	}

	const [rows, setRows] = createSignal<readonly ChatRow[]>([])
	// roles 上限（第二轮审查修复：长会话 messageID 持续累积构成内存泄漏；
	// 超限裁掉最旧一半——Map 迭代序即插入序，角色判定只需覆盖近期消息）
	const ROLES_LIMIT = 1024
	const roles = new Map<string, string>()
	let sessionID: string | undefined
	let offEvents: (() => void) | undefined
	// 流式文本累积：textID -> 已到达文本（session.next.text.delta 增量）
	const textStreams = new Map<string, string>()
	let localSeq = 0

	const upsert = (row: ChatRow) => {
		setRows((prev) => {
			const index = prev.findIndex((r) => r.id === row.id)
			if (index < 0) return [...prev, row]
			const next = [...prev]
			next[index] = row
			return next
		})
	}

	const pushSystem = (text: string) => {
		setRows((prev) => [...prev, { id: `sys-${Date.now()}-${prev.length}`, label: "系统", text, kind: "system" }])
	}

	offEvents = await options.events.subscribe((raw) => {
		const event = eventOf(raw)
		if (isMessageUpdated(event)) {
			roles.set(event.properties.info.id, event.properties.info.role)
			if (roles.size > ROLES_LIMIT) {
				// 裁掉最旧一半（迭代序即插入序）
				const drop = roles.size - ROLES_LIMIT / 2
				let n = 0
				for (const key of roles.keys()) {
					if (n >= drop) break
					roles.delete(key)
					n += 1
				}
			}
			return
		}
		if (isTextDelta(event)) {
			const p = event.properties
			if (sessionID !== undefined && p.sessionID !== sessionID) return
			const text = (textStreams.get(p.textID) ?? "") + p.delta
			textStreams.set(p.textID, text)
			upsert({ id: `t-${p.textID}`, label: "助手", text, kind: "assistant" })
			return
		}
		if (isTextEnded(event)) {
			const p = event.properties
			if (sessionID !== undefined && p.sessionID !== sessionID) return
			textStreams.delete(p.textID)
			upsert({ id: `t-${p.textID}`, label: "助手", text: p.text, kind: "assistant" })
			return
		}
		if (!isPartUpdated(event)) return
		const part = event.properties.part
		if (sessionID !== undefined && part.sessionID !== sessionID) return
		// user 消息的 part 不入流（本地回显）；已知 assistant 的 part 才展示，
		// role 未知的 part（事件乱序到达）默认按 assistant 处理
		if (roles.get(part.messageID) === "user") return
		const row = partToRow(part)
		if (row) upsert(row)
	})

	let creatingSession: Promise<string | undefined> | undefined

	const ensureSession = (): Promise<string | undefined> => {
		if (sessionID !== undefined) return Promise.resolve(sessionID)
		// 并发去重：连发两条消息不得创建两个会话（首个 create 在途时共享同一 Promise）
		creatingSession ??= (async () => {
			try {
				const res = await client.session.create({ directory: options.directory })
				if (res.error || !res.data) {
					pushSystem(`创建会话失败: ${String((res.error as { message?: string })?.message ?? res.error ?? "unknown")}`)
					return undefined
				}
				sessionID = res.data.id
				return sessionID
			} finally {
				creatingSession = undefined
			}
		})()
		return creatingSession
	}

	const send = (text: string) => {
		// 本地回显用户消息（UI 统一读 chat.rows()，assistant 事件按 textID 追加）
		upsert({ id: `u-${Date.now()}-${localSeq++}`, label: "你", text, kind: "user" })
		void (async () => {
			const id = await ensureSession()
			if (id === undefined) return
			const res = (await client.v2.session.prompt(
				{
					sessionID: id,
					prompt: { text },
				},
				{ throwOnError: false },
			)) as { error?: { message?: string } } | undefined
			if (res?.error) pushSystem(`发送失败: ${String(res.error.message ?? res.error)}`)
		})()
	}

	return {
		rows,
		send,
		dispose: () => {
			offEvents?.()
			offEvents = undefined
		},
	}
}
