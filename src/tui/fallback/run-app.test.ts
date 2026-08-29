import { describe, expect, test } from "bun:test"
import { MemoryBackend } from "./terminal"
import { flushSync } from "./solid"
import { runFallbackApp } from "./run-app"

describe("runFallbackApp 端到端冒烟", () => {
	test("启动→输出 fallback 标识→Escape 退出，进程正常终止无抛错", async () => {
		const backend = new MemoryBackend(80, 24)
		const appPromise = runFallbackApp({ backend })
		await new Promise((r) => setTimeout(r, 200))
		flushSync()

		expect(backend.output.length).toBeGreaterThan(0)
		expect(backend.output).toContain("\x1b[?1049h")
		expect(backend.output).toContain("gyc-code")

		backend.emitInput("\x1b")
		await appPromise

		const outputAfterStop = backend.output
		await new Promise((r) => setTimeout(r, 100))
		expect(backend.output).toBe(outputAfterStop)
	})

	test("无 transport 时降级本地回显（grid 首行验证）", async () => {
		const { FallbackRenderer } = await import("./terminal")
		const backend = new MemoryBackend(80, 24)
		const renderer = new FallbackRenderer(backend)
		// 直接起渲染器，绕开 run-app 的 watchTerminalClose 副作用
		renderer.start()
		const { renderRoot } = await import("./solid")
		const { FallbackApp } = await import("./app")
		const { createComponent } = await import("solid-js")
		const dispose = renderRoot(
			() =>
				createComponent(FallbackApp, {
					onExit: () => {},
					onReady: () => {},
				}),
			renderer,
		)
		flushSync()
		const snap = renderer.currentScreen.snapshot()
		expect(snap[0]!.trim()).toContain("gyc-code")
		expect(snap[0]!.trim()).toContain("fallback")
		dispose()
		renderer.stop()
	})

	test("多次启动/停止安全退出（幂等 stop）", async () => {
		const backend = new MemoryBackend(80, 24)

		const p1 = runFallbackApp({ backend })
		await new Promise((r) => setTimeout(r, 100))
		backend.emitInput("\x1b")
		await p1

		const p2 = runFallbackApp({ backend })
		await new Promise((r) => setTimeout(r, 100))
		backend.emitInput("\x1b")
		await p2
	})
})
