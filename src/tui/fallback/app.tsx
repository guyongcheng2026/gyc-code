/** @jsxImportSource #fallback-solid */
import { createSignal, For, onMount } from "solid-js"
import type { Key } from "./input"
import { ScrollBox, Textarea, type ScrollBoxApi, type TextareaApi } from "./solid"
import type { JSX } from "./solid/jsx-runtime"

/**
 * S1 组件桥接：fallback 会话视图（Solid 组件树）。
 *
 * GYC_TUI_BACKEND=fallback 的主界面：标题条 + 消息流（滚动）+ 状态条 +
 * 多行输入。S1 为本地回显视图（会话引擎 RPC 接线属 S2 灰度切换）。
 * 崩溃降级路径仍走 DemoApp（更简单更稳）。
 */

export interface FallbackAppApi {
	handleKey(key: Key): void
}

export interface FallbackAppProps {
	onExit(): void
	onReady(api: FallbackAppApi): void
}

export function FallbackApp(props: FallbackAppProps): JSX.Element {
	const [messages, setMessages] = createSignal<string[]>([
		"系统: gyc-code fallback 会话视图（S1 组件桥接）",
		"说明: 纯 JS 差分帧渲染引擎 + Solid 组件树，零原生依赖",
	])
	let scroller: ScrollBoxApi | undefined
	let input: TextareaApi | undefined

	const pushMessage = (text: string) => {
		setMessages((prev) => [...prev, text])
		scroller?.scrollToBottom()
	}

	const handleSubmit = (text: string) => {
		pushMessage(`你: ${text}`)
		// 本地回显：S2 灰度切换时接入会话引擎 RPC
		setTimeout(() => pushMessage(`回显: 已收到 ${text.length} 字符（会话引擎接线属 S2）`), 200)
	}

	const handleKey = (key: Key): void => {
		if (key.type === "escape" || key.type === "ctrl-c") {
			props.onExit()
			return
		}
		if (input?.handleKey(key)) return
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
	// 初始底部对齐（消息超一屏时直接看到最新内容）
	onMount(() => scroller?.scrollToBottom())

	return (
		<box flex>
			<box height={1} style={{ fg: "#ffffff", bg: "#0000aa", reverse: true }}>
				gyc-code · fallback（S1 组件桥接）
			</box>
			<ScrollBox
				flex
				ref={(api) => {
					scroller = api
				}}
			>
				<For each={messages()}>{(message) => <text>{message}</text>}</For>
			</ScrollBox>
			<box height={1} style={{ dim: true }}>
				Enter 发送 · ↑↓/PgUp/PgDn 滚动 · Esc/Ctrl+C 退出
			</box>
			<Textarea
				height={3}
				style={{ fg: "#ffffff" }}
				onSubmit={handleSubmit}
				ref={(api) => {
					input = api
				}}
			/>
		</box>
	)
}
