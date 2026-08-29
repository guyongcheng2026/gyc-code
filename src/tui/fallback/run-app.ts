import { KeyParser, setSgrMouse, disableMouse, type Key } from "./input"
import { FallbackRenderer, ProcessBackend, type TerminalBackend } from "./terminal"
import { flushSync, renderRoot } from "./solid"
import { createComponent } from "solid-js"
import { probeTerminal, renderBudget } from "./capability"
import type { FallbackAppApi } from "./app"

/**
 * S1 组件桥接：fallback 会话视图运行入口。
 *
 * 组装 FallbackRenderer + Solid 组件树（FallbackApp）+ KeyParser 键路由。
 * slice 2：可选注入 transport（fetch/events/url）时创建 ChatBridge，
 * 接线真实会话引擎（session.create + prompt + 事件流）。
 * 退出条件：Esc/Ctrl+C（app 层 onExit）或终端关闭。
 */

export interface RunFallbackAppOptions {
	backend?: TerminalBackend
	/** 会话引擎 transport（三件齐备才接线；缺省为本地回显模式） */
	transport?: {
		url: string
		fetch?: typeof fetch
		headers?: RequestInit["headers"]
		events: {
			subscribe: (handler: (event: unknown) => void) => Promise<() => void>
		}
	}
	directory?: string
}

export async function runFallbackApp(options: RunFallbackAppOptions = {}): Promise<void> {
	const backend = options.backend ?? new ProcessBackend(process.stdout, process.stdin)
	const probe = probeTerminal()
	const budget = renderBudget(probe)
	const renderer = new FallbackRenderer(backend, budget)
	renderer.start()

	let done = false
	let disposeTree: (() => void) | undefined
	const finish = () => {
		if (done) return
		done = true
		try {
			flushSync()
		} catch {}
		disposeTree?.()
		renderer.stop()
	}

	const { FallbackApp } = await import("./app")
	const { win32DisableProcessedInput, watchTerminalClose } = await import("../terminal-win32")
	// Win32 必备：关闭 ENABLE_PROCESSED_INPUT，避免 Windows 控制台加工输入
	// （如 Ctrl+C 触发 SIGINT 杀进程、C 字符被翻译等）。
	win32DisableProcessedInput()
	const offWatchClose = watchTerminalClose(finish)

	// 会话引擎桥：transport 齐备时接线（失败降级本地回显并提示）
	let chat: Awaited<ReturnType<typeof createChatBridgeSafe>> = undefined
	if (options.transport && options.directory) {
		chat = await createChatBridgeSafe(options.transport, options.directory)
	}

	let appApi: FallbackAppApi | undefined
	disposeTree = renderRoot(
		() =>
			createComponent(FallbackApp, {
				onExit: finish,
				chat,
				backend,
				onReady: (api) => {
					appApi = api
				},
			}),
		renderer,
	)

	const parser = new KeyParser((key: Key) => {
		if (done) return
		if (key.type === "escape" || key.type === "ctrl-c") {
			finish()
			return
		}
		appApi?.handleKey(key)
	})
	backend.onInput((chunk) => parser.feed(chunk))

	// 启用 SGR 鼠标追踪（1006 + 1002 拖动 + 1005 UTF-8 编码）
	setSgrMouse((d) => backend.write(d))

	await new Promise<void>((resolve) => {
		const timer = setInterval(() => {
			if (done) {
				clearInterval(timer)
				resolve()
			}
		}, 50)
	})
	chat?.dispose()
	offWatchClose()
	disableMouse((d) => backend.write(d))
}

async function createChatBridgeSafe(
	transport: NonNullable<RunFallbackAppOptions["transport"]>,
	directory: string,
) {
	try {
		const { createChatBridge } = await import("./chat-bridge")
		return await createChatBridge({
			url: transport.url,
			fetch: transport.fetch,
			headers: transport.headers,
			events: transport.events as Parameters<typeof createChatBridge>[0]["events"],
			directory,
		})
	} catch {
		return undefined
	}
}
