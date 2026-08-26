/** @jsxImportSource #fallback-solid */
import { createEffect, createSignal, For, onCleanup, onMount } from "solid-js"
import type { Key } from "./input"
import { Markdown, ScrollBox, Textarea, type ScrollBoxApi, type TextareaApi } from "./solid"
import type { ChatBridge, ChatRow } from "./chat-bridge"
import type { JSX } from "./solid/jsx-runtime"

/**
 * S1 组件桥接：fallback 会话视图（Solid 组件树）。
 *
 * GYC_TUI_BACKEND=fallback 的主界面：标题条 + 消息流（滚动）+ 状态条 +
 * 多行输入。slice 2 起：
 * - ChatBridge 注入（真实会话引擎 RPC）——无 bridge 时退回本地回显
 * - 输入区光标闪烁（500ms 相位切换，paint 层 cursorVisible 控制）
 */

export interface FallbackAppApi {
	handleKey(key: Key): void
}

export interface FallbackAppProps {
	onExit(): void
	onReady(api: FallbackAppApi): void
	/** 会话引擎桥（可选；缺省为本地回显模式） */
	chat?: ChatBridge
}

const CURSOR_BLINK_MS = 500

function rowStyle(row: ChatRow): JSX.IntrinsicElements["text"]["style"] {
	if (row.kind === "system") return { dim: true }
	if (row.kind === "tool") return { fg: "#d73a49" }
	if (row.kind === "reasoning") return { fg: "#6a737d", italic: true }
	if (row.kind === "user") return { fg: "#005cc5", bold: true }
	return { fg: "#22863a" }
}

export function FallbackApp(props: FallbackAppProps): JSX.Element {
	const localRows = createSignal<readonly ChatRow[]>([
		{ id: "welcome-1", label: "系统", text: "gyc-code fallback 会话视图（S1 组件桥接）", kind: "system" },
		{
			id: "welcome-2",
			label: "系统",
			text: props.chat ? "已接线会话引擎，输入消息回车发送" : "纯 JS 差分帧渲染引擎 + Solid 组件树，零原生依赖",
			kind: "system",
		},
	])
	const rows = () => props.chat?.rows() ?? localRows[0]()
	let scroller: ScrollBoxApi | undefined
	let input: TextareaApi | undefined

	// 光标闪烁：输入区空闲闪烁，键入时重置相位（恒亮 500ms 再起闪）
	const [cursorVisible, setCursorVisible] = createSignal(true)
	let blinkTimer: ReturnType<typeof setInterval> | undefined
	const restartBlink = () => {
		setCursorVisible(true)
		if (blinkTimer) clearInterval(blinkTimer)
		blinkTimer = setInterval(() => setCursorVisible((v) => !v), CURSOR_BLINK_MS)
	}
	onMount(() => restartBlink())
	onCleanup(() => {
		if (blinkTimer) clearInterval(blinkTimer)
	})

	const pushLocal = (row: ChatRow) => {
		localRows[1]((prev) => [...prev, row])
		scroller?.scrollToBottom()
	}

	const handleSubmit = (text: string) => {
		pushLocal({ id: `u-${Date.now()}`, label: "你", text, kind: "user" })
		if (props.chat) {
			props.chat.send(text)
		} else {
			setTimeout(() => {
				pushLocal({
					id: `a-${Date.now()}`,
					label: "回显",
					text: `已收到 ${text.length} 字符（无会话引擎，本地回显模式）`,
					kind: "system",
				})
			}, 200)
		}
	}

	const handleKey = (key: Key): void => {
		if (key.type === "escape" || key.type === "ctrl-c") {
			props.onExit()
			return
		}
		if (input?.handleKey(key)) {
			restartBlink()
			return
		}
		switch (key.type) {
			case "up":
				scroller?.scrollBy(-1)
				return
			case "down":
				scroller?.scrollBy(1)
				return
			case "pageup":
				scroller?.scrollBy(-10)
				return
			case "pagedown":
				scroller?.scrollBy(10)
				return
			default:
				return
		}
	}
	props.onReady({ handleKey })

	// 行流变化时保持底部跟随（effect 追踪 rows() 的每次变更）
	const TrackBottom = (): JSX.Element => {
		createEffect(() => {
			rows()
			scroller?.scrollToBottom()
		})
		return null as unknown as JSX.Element
	}

	return (
		<box flex>
			<box height={1} style={{ fg: "#ffffff", bg: "#0000aa", reverse: true }}>
				gyc-code · fallback（S1 组件桥接{props.chat ? " · 会话引擎已接线" : " · 本地回显"}）
			</box>
			<ScrollBox
				flex
				ref={(api) => {
					scroller = api
				}}
			>
				<TrackBottom />
				<For each={rows()}>
					{(row) => (
						<box>
							{row.kind === "assistant" ? (
								// 助手回复：Markdown 渲染（标题/列表/代码块/行内标记）
								<Markdown source={`${row.label}: ${row.text}`} />
							) : (
								<text style={rowStyle(row)}>
									{row.label}: {row.text}
								</text>
							)}
						</box>
					)}
				</For>
			</ScrollBox>
			<box height={1} style={{ dim: true }}>
				Enter 发送 · ↑↓/PgUp/PgDn 滚动 · Esc/Ctrl+C 退出
			</box>
			<Textarea
				height={3}
				style={{ fg: "#ffffff" }}
				onSubmit={handleSubmit}
				cursorVisible={cursorVisible()}
				ref={(api) => {
					input = api
				}}
			/>
		</box>
	)
}
