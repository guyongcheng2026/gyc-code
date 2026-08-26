import { KeyParser, type Key } from "./input"
import { FallbackRenderer, ProcessBackend, type TerminalBackend } from "./terminal"
import { flushSync, renderRoot } from "./solid"
import { createComponent } from "solid-js"
import type { FallbackAppApi } from "./app"

/**
 * S1 组件桥接：fallback 会话视图运行入口。
 *
 * 组装 FallbackRenderer + Solid 组件树（FallbackApp）+ KeyParser 键路由。
 * 退出条件：Esc/Ctrl+C（app 层 onExit）或终端关闭。
 */

export interface RunFallbackAppOptions {
	backend?: TerminalBackend
	/** 终端关闭检测注入点（测试用）；默认 watchTerminalClose */
}

export async function runFallbackApp(options: RunFallbackAppOptions = {}): Promise<void> {
	const backend = options.backend ?? new ProcessBackend(process.stdout, process.stdin)
	const renderer = new FallbackRenderer(backend)
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
	const { watchTerminalClose } = await import("../terminal-win32")
	const offWatchClose = watchTerminalClose(finish)

	let appApi: FallbackAppApi | undefined
	disposeTree = renderRoot(
		() =>
			createComponent(FallbackApp, {
				onExit: finish,
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

	await new Promise<void>((resolve) => {
		const timer = setInterval(() => {
			if (done) {
				clearInterval(timer)
				resolve()
			}
		}, 50)
	})
	offWatchClose()
}
