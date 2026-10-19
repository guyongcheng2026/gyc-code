import type { FallbackNode } from "../solid/nodes"

/**
 * M2：事件分发（对齐 opentui `Renderable.d.ts:72-86` 的 12 个事件属性）。
 *
 * 冒泡语义（与 opentui 的 processMouseEvent 一致）：
 *  - 从命中节点开始沿 parent 链向上；
 *  - 每层调用对应 props 上的 handler；
 *  - handler 返回 `false` 表示"到此为止"（等价 opentui 的 stopPropagation），
 *    返回 `true`/`undefined` 继续冒泡；
 *  - `handled` 为 true 表示至少有一个 handler 被调用过。
 */

export type MouseEventKind = "down" | "up" | "move" | "drag" | "scroll" | "over" | "out"

export interface KeyModifiers {
	readonly shift: boolean
	readonly alt: boolean
	readonly ctrl: boolean
	readonly meta: boolean
}

export const NO_MODIFIERS: KeyModifiers = { shift: false, alt: false, ctrl: false, meta: false }

export interface MousePayload {
	readonly x: number
	readonly y: number
	/** 0 左键 / 1 中键 / 2 右键 / 64 上滚 / 65 下滚（与 SGR 编码一致） */
	readonly button: number
	readonly modifiers: KeyModifiers
}

export interface DispatchResult {
	/** 是否命中并调用过 handler */
	readonly handled: boolean
	/** 最后一个被调用的节点（诊断用） */
	readonly last: FallbackNode | undefined
}

const MOUSE_HANDLERS: Record<MouseEventKind, string> = {
	down: "onMouseDown",
	up: "onMouseUp",
	move: "onMouseMove",
	drag: "onMouseDrag",
	scroll: "onMouseScroll",
	over: "onMouseOver",
	out: "onMouseOut",
}

type Handler = (payload: unknown) => unknown

function handlerOf(node: FallbackNode, name: string): Handler | undefined {
	if (node.kind !== "element") return undefined
	const value = node.props[name]
	return typeof value === "function" ? (value as Handler) : undefined
}

/** 沿 parent 链冒泡调用，返回是否被处理。 */
function bubble(target: FallbackNode | undefined, name: string, payload: unknown): DispatchResult {
	let cursor = target
	let handled = false
	let last: FallbackNode | undefined
	while (cursor !== undefined) {
		const handler = handlerOf(cursor, name)
		if (handler !== undefined) {
			handled = true
			last = cursor
			const stop = handler(payload) === false
			if (stop) break
		}
		cursor = cursor.parent
	}
	return { handled, last }
}

/** 鼠标事件分发（target 由 `HitGrid.at()` 给出）。 */
export function dispatchMouse(target: FallbackNode | undefined, kind: MouseEventKind, payload: MousePayload): DispatchResult {
	return bubble(target, MOUSE_HANDLERS[kind], payload)
}

/** 键盘事件分发（从焦点节点向上）。 */
export function dispatchKey(target: FallbackNode | undefined, key: unknown): DispatchResult {
	return bubble(target, "onKeyDown", key)
}

/** 粘贴事件分发（bracketed paste 解出的整段文本）。 */
export function dispatchPaste(target: FallbackNode | undefined, text: string): DispatchResult {
	return bubble(target, "onPaste", { text })
}

/** 尺寸变化分发（用于 onSizeChange 响应式重算）。 */
export function dispatchSizeChange(target: FallbackNode | undefined): DispatchResult {
	return bubble(target, "onSizeChange", undefined)
}
