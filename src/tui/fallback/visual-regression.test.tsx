/** @jsxImportSource #fallback-solid */
import { describe, expect, test } from "bun:test"
import { FallbackRenderer, MemoryBackend } from "./terminal"
import { renderRoot, flushSync } from "./solid"

describe("视觉回归 baseline", () => {
	test("app 标题栏：条件表达式独立节点时完整显示", async () => {
		const backend = new MemoryBackend(80, 24)
		const renderer = new FallbackRenderer(backend)
		renderer.start()
		const { FallbackApp } = await import("./app")
		const { createComponent } = await import("solid-js")
		const dispose = renderRoot(
			() => createComponent(FallbackApp, { onExit: () => {}, onReady: () => {} }),
			renderer,
		)
		flushSync()
		const snap = renderer.currentScreen.snapshot()
		expect(snap[0]!.includes("gyc-code")).toBe(true)
		expect(snap[0]!.includes("fallback")).toBe(true)
		expect(snap[0]!.includes("本地回显")).toBe(true)
		dispose()
		renderer.stop()
	})

	test("app 欢迎消息：系统提示可见", async () => {
		const backend = new MemoryBackend(80, 24)
		const renderer = new FallbackRenderer(backend)
		renderer.start()
		const { FallbackApp } = await import("./app")
		const { createComponent } = await import("solid-js")
		const dispose = renderRoot(
			() => createComponent(FallbackApp, { onExit: () => {}, onReady: () => {} }),
			renderer,
		)
		flushSync()
		const snap = renderer.currentScreen.snapshot()
		const all = snap.join("")
		expect(all.includes("S1 组件桥接")).toBe(true)
		expect(all.includes("零原生依赖")).toBe(true)
		dispose()
		renderer.stop()
	})
})
