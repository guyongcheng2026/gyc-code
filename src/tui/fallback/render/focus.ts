import type { FallbackNode } from "../solid/nodes"

/**
 * M2：焦点链（对齐 opentui `Renderable.focus/blur/focused/hasFocusedDescendant`，
 * 见 node_modules/@opentui/core/Renderable.d.ts:176-184 与 `focused_renderable`
 * 事件 types.d.ts:97）。
 *
 * 语义：
 *  - 同一时刻只有一个焦点节点（终端 UI 无并发焦点）。
 *  - `isFocused(node)` 对「焦点节点自身及其祖先」返回 true（父级据此绘制高亮边框）。
 *  - `focus()` 显式调用即生效，不校验 `focusable`：可聚焦性由 Tab 导航消费方判断
 *    （避免在此处猜测默认值——opentui 默认 focusable=false，而 fallback 组件尚未标注）。
 */

export type FocusListener = (current: FallbackNode | undefined, previous: FallbackNode | undefined) => void

export interface FocusManager {
	current(): FallbackNode | undefined
	/** 聚焦指定节点；与当前相同则无操作。 */
	focus(node: FallbackNode): void
	/** 失焦：传 node 时仅在它是当前焦点时清除。 */
	blur(node?: FallbackNode): void
	/** 自身或其后代是否持有焦点（父级高亮用）。 */
	isFocused(node: FallbackNode): boolean
	/** 是否就是焦点节点本身。 */
	isSelfFocused(node: FallbackNode): boolean
	/** 订阅焦点变化，返回取消函数。 */
	onChange(listener: FocusListener): () => void
}

export function createFocusManager(): FocusManager {
	let current: FallbackNode | undefined
	const listeners = new Set<FocusListener>()

	const emit = (previous: FallbackNode | undefined) => {
		for (const listener of listeners) listener(current, previous)
	}

	return {
		current: () => current,
		focus(node) {
			if (current === node) return
			const previous = current
			current = node
			emit(previous)
		},
		blur(node) {
			if (node !== undefined && current !== node) return
			if (current === undefined) return
			const previous = current
			current = undefined
			emit(previous)
		},
		isFocused(node) {
			if (current === undefined) return false
			let cursor: FallbackNode | undefined = current
			while (cursor !== undefined) {
				if (cursor === node) return true
				cursor = cursor.parent
			}
			return false
		},
		isSelfFocused: (node) => current === node,
		onChange(listener) {
			listeners.add(listener)
			return () => {
				listeners.delete(listener)
			}
		},
	}
}
