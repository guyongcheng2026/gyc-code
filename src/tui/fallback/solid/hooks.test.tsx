/** @jsxImportSource #fallback-solid */
import { describe, expect, test } from "bun:test"
import { createSignal } from "solid-js"
import { FallbackRenderer, MemoryBackend } from "../terminal"
import { Box, Text } from "./components"
import { KeyBus } from "./context"
import { useKeyboard, useTerminalDimensions } from "./hooks"
import { flushSync, renderRoot } from "./renderer"

function Probe() {
	const dims = useTerminalDimensions()
	const [last, setLast] = createSignal("-")
	useKeyboard((key) => setLast(key.type))
	return (
		<Box height={1}>
			<Text>{`${dims().width}x${dims().height} ${last()}`}</Text>
		</Box>
	)
}

function setup(width = 20, height = 5) {
	const backend = new MemoryBackend(width, height)
	const renderer = new FallbackRenderer(backend)
	renderer.start()
	const bus = new KeyBus()
	const dispose = renderRoot(() => <Probe />, renderer, { bus })
	flushSync()
	return { backend, renderer, bus, dispose }
}

describe("M7 hooks", () => {
	test("useTerminalDimensions 初值来自渲染器", () => {
		const { renderer, dispose } = setup(20, 5)
		expect(renderer.currentScreen.snapshot()[0]).toContain("20x5")
		dispose()
		renderer.stop()
	})

	test("resize 后尺寸自动更新", () => {
		const { backend, renderer, dispose } = setup(20, 5)
		backend.emitResize(30, 6)
		flushSync()
		expect(renderer.currentScreen.snapshot()[0]).toContain("30x6")
		dispose()
		renderer.stop()
	})

	test("useKeyboard 收到总线按键", () => {
		const { renderer, bus, dispose } = setup()
		bus.emit({ type: "text", text: "a" })
		flushSync()
		expect(renderer.currentScreen.snapshot()[0]).toContain("text")
		bus.emit({ type: "paste", text: "x" })
		flushSync()
		expect(renderer.currentScreen.snapshot()[0]).toContain("paste")
		dispose()
		renderer.stop()
	})

	test("卸载后不再接收按键", () => {
		const { renderer, bus, dispose } = setup()
		dispose()
		expect(bus.emit({ type: "enter" })).toBe(false)
		renderer.stop()
	})
})
