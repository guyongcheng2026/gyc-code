import { createSignal, onCleanup, useContext } from "solid-js"
import type { Key } from "../input"
import type { FallbackRenderer } from "../terminal"
import { KeyBusContext, RendererContext, type KeyBus } from "./context"

/**
 * M7：应用层 hooks（对齐 @opentui/solid/src/elements/hooks.d.ts:2-38）。
 *
 * 产线用量：`useTerminalDimensions` 17 处、`useRenderer` 14 处、`useKeyboard` 4 处。
 * 与 opentui 的差异：无 Provider 时不抛错，而是降级为安全空值/空操作——
 * 这样局部渲染（测试、文档示例）无需额外包裹 Provider。
 */

/** 当前渲染器；无 Provider 时抛错（与 opentui 一致：渲染器是强依赖）。 */
export function useRenderer(): FallbackRenderer {
	const renderer = useContext(RendererContext)
	if (renderer === undefined) throw new Error("useRenderer 必须在 renderRoot 的渲染上下文内调用")
	return renderer
}

/** 终端尺寸（随 resize 自动更新）。无 Provider 时返回 {0,0} 的静态值。 */
export function useTerminalDimensions(): () => { width: number; height: number } {
	const renderer = useContext(RendererContext)
	if (renderer === undefined) return () => ({ width: 0, height: 0 })
	const [size, setSize] = createSignal({ width: renderer.getWidth(), height: renderer.getHeight() })
	const off = renderer.onResize(() => setSize({ width: renderer.getWidth(), height: renderer.getHeight() }))
	onCleanup(off)
	return size
}

/** 订阅终端 resize。 */
export function onResize(callback: (width: number, height: number) => void): void {
	const renderer = useContext(RendererContext)
	if (renderer === undefined) return
	const off = renderer.onResize(() => callback(renderer.getWidth(), renderer.getHeight()))
	onCleanup(off)
}

function useBus(): KeyBus | undefined {
	return useContext(KeyBusContext)
}

/** 订阅按键（按下与粘贴都从总线来；粘贴事件可用 `usePaste` 单独处理）。 */
export function useKeyboard(callback: (key: Key) => void): void {
	const bus = useBus()
	if (bus === undefined) return
	const off = bus.subscribe(callback)
	onCleanup(off)
}

/** 只订阅 bracketed paste。 */
export function usePaste(callback: (text: string) => void): void {
	useKeyboard((key) => {
		if (key.type === "paste") callback(key.text)
	})
}

/** 只订阅终端焦点变化。 */
export function onFocus(callback: () => void): void {
	useKeyboard((key) => {
		if (key.type === "focus" && key.focused) callback()
	})
}

export function onBlur(callback: () => void): void {
	useKeyboard((key) => {
		if (key.type === "focus" && !key.focused) callback()
	})
}
