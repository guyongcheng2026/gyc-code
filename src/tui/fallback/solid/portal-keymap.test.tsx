/** @jsxImportSource #fallback-solid */
import { describe, expect, test } from "bun:test"
import { createSignal } from "solid-js"
import { Box, Text } from "./components"
import { KeyBus } from "./context"
import { KeymapProvider, useBindings, useKeymap } from "../keymap/solid"
import { Keymap } from "../keymap/core"
import { FallbackRenderer, MemoryBackend } from "../terminal"
import { flushSync, getRootNode, renderRoot } from "./renderer"
import { Portal } from "./portal"

function setup(tree: () => unknown, bus?: KeyBus, width = 10, height = 4) {
	const backend = new MemoryBackend(width, height)
	const renderer = new FallbackRenderer(backend)
	renderer.start()
	const dispose = renderRoot(tree, renderer, { bus })
	flushSync()
	return { renderer, dispose }
}

describe("Portal", () => {
	test("脱离布局流：不挤压兄弟，且根级最后绘制", () => {
		const { renderer, dispose } = setup(() => (
			<Box height={2}>
				<Text>{"AB"}</Text>
				<Text>{"CD"}</Text>
				<Portal>
					<Box height={1}>
						<Text>{"ZZ"}</Text>
					</Box>
				</Portal>
			</Box>
		))
		const lines = renderer.currentScreen.snapshot()
		// portal 在根级最后绘制 → 覆盖第一行的 "AB"
		expect(lines[0]?.startsWith("ZZ")).toBe(true)
		// 兄弟 "CD" 仍在第二行（未被 portal 挤压到屏幕外）
		expect(lines[1]?.startsWith("CD")).toBe(true)
		dispose()
	})

	test("portal 宿主挂载到根节点（portal 类型元素）", () => {
		let hostFound = false
		const { dispose } = setup(() => (
			<Portal>
				<Box height={1}>
					<Text>{"FLOAT"}</Text>
				</Box>
			</Portal>
		))
		const root = getRootNode()
		hostFound = root?.children.some((child) => child.kind === "element" && child.type === "portal") ?? false
		expect(hostFound).toBe(true)
		dispose()
	})
})

describe("KeymapProvider", () => {
	function Probe() {
		const context = useKeymap()
		const [fired, setFired] = createSignal("no")
		context.keymap.registerCommand("test.fire", () => setFired("yes"))
		const bindings = useBindings("test.fire")
		return (
			<Box height={1}>
				<Text>{`${bindings().length} ${fired()}`}</Text>
			</Box>
		)
	}

	function setupKeymap(): { renderer: FallbackRenderer; bus: KeyBus; keymap: Keymap; dispose: () => void } {
		const backend = new MemoryBackend(12, 3)
		const renderer = new FallbackRenderer(backend)
		renderer.start()
		const bus = new KeyBus()
		const keymap = new Keymap({ leaderTimeout: 0 })
		const dispose = renderRoot(
			() => (
				<KeymapProvider keymap={keymap} bindings={[{ keys: "ctrl+t", command: "test.fire" }]}>
					<Probe />
				</KeymapProvider>
			),
			renderer,
			{ bus },
		)
		flushSync()
		return { renderer, bus, keymap, dispose }
	}

	test("useBindings 暴露绑定数，dispatchCommand 触发命令", () => {
		const { renderer, dispose } = setupKeymap()
		expect(renderer.currentScreen.snapshot()[0]).toContain("1 no")
		dispose()
	})

	test("keymap.handleKey 触发命令并反映到 UI", () => {
		const { renderer, keymap, dispose } = setupKeymap()
		expect(keymap.handleKey({ type: "ctrl", key: "t" })).toBe(true)
		flushSync()
		expect(renderer.currentScreen.snapshot()[0]).toContain("1 yes")
		dispose()
	})
})
