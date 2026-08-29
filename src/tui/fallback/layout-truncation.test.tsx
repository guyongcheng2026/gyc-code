/** @jsxImportSource #fallback-solid */
import { describe, expect, test } from "bun:test"
import { FallbackRenderer, MemoryBackend } from "./terminal"
import { renderRoot, flushSync } from "./solid"

describe("layout 文字截断 bug 复现", () => {
	test("text 元素：中文+全角圆括号+点号混合 — wrap 不应提前折行", () => {
		const backend = new MemoryBackend(80, 24)
		const renderer = new FallbackRenderer(backend)
		renderer.start()
		const dispose = renderRoot(() => <text>gyc-code · fallback（S1 组件桥接 · 本地回显）</text>, renderer)
		flushSync()
		const snap = renderer.currentScreen.snapshot()
		expect(snap[0]!.includes("本地回显")).toBe(true)
		dispose()
		renderer.stop()
	})

	test("text 元素：纯中文长串 — 72 列宽（<80）完整在一行", () => {
		const backend = new MemoryBackend(80, 24)
		const renderer = new FallbackRenderer(backend)
		renderer.start()
		const long = "中文字符串测".repeat(6)
		const dispose = renderRoot(() => <text>{long}</text>, renderer)
		flushSync()
		const snap = renderer.currentScreen.snapshot()
		const expected = "中文字符串测".repeat(6)
		expect(snap[0]!.trimEnd().startsWith(expected)).toBe(true)
		expect(snap[1]!.trim()).toBe("") // 不应折行
		dispose()
		renderer.stop()
	})
})
