/** @jsxImportSource #fallback-solid */
import { ErrorBoundary, type JSX } from "solid-js"
import { FallbackApp, type FallbackAppApi } from "./app"
import type { ChatBridge } from "./chat-bridge"

/**
 * fallback ErrorBoundary 包裹层。
 *
 * 捕获 Solid 组件渲染时的未捕获异常（child 组件抛错），降级到"安全屏"。
 * 与 Claude Code ErrorComponent 对齐：用户不丢上下文，可继续操作或退出。
 */

function formatError(err: unknown): string {
	if (err instanceof Error) return err.message
	if (typeof err === "string") return err
	try {
		return JSON.stringify(err)
	} catch {
		return String(err)
	}
}

function ErrorScreen(props: { error: unknown; onExit: () => void }): JSX.Element {
	const detail = formatError(props.error).slice(0, 800)
	return (
		<box flex>
			<box height={1} style={{ fg: "#ffffff", bg: "#aa0000", reverse: true }}>
				{"fallback 渲染异常（已降级到安全屏）"}
			</box>
			<box flex>
				<text>{`错误摘要：${detail.slice(0, 200)}`}</text>
			</box>
			<box height={1}>
				<text>{"按 Esc 退出 fallback 渲染器"}</text>
			</box>
		</box>
	)
}

export interface SafeFallbackAppProps {
	onExit: () => void
	chat?: ChatBridge
	backend?: { write(data: string): void; getHeight(): number }
	onReady: (api: FallbackAppApi) => void
}

/**
 * ErrorBoundary 包裹器：上层传入实际 app props，内部捕获渲染异常。
 * 注：FallbackAppProps 接口未声明 backend 字段，但内部使用——用 any bridge 兼容。
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const CompatFallbackApp = FallbackApp as unknown as (props: any) => JSX.Element

export function SafeFallbackApp(props: SafeFallbackAppProps): JSX.Element {
	return (
		<ErrorBoundary
			fallback={(err: unknown) => <ErrorScreen error={err} onExit={props.onExit} />}
		>
			<CompatFallbackApp
				onExit={props.onExit}
				chat={props.chat}
				backend={props.backend}
				onReady={props.onReady}
			/>
		</ErrorBoundary>
	)
}
