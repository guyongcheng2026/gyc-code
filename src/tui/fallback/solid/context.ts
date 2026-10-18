import { createContext } from "solid-js"
import type { Key } from "../input"
import type { FallbackRenderer } from "../terminal"

/**
 * M7：应用层上下文（对齐 @opentui/solid 的 RendererContext 与 keymap 分发）。
 *
 * `renderRoot` 会把这两个 Provider 包在应用树外层；组件通过 `hooks.ts` 消费。
 * 没有 Provider 时 hooks 不抛错（降级为空操作），避免测试/局部渲染被上下文绑定。
 */

export const RendererContext = createContext<FallbackRenderer>()

/**
 * 键盘/粘贴/焦点事件总线：run-app 的 KeyParser 把按键发到这里，
 * 组件用 `useKeyboard` / `usePaste` / `onFocus` 订阅。
 */
export class KeyBus {
	private listeners = new Set<(key: Key) => void>()

	subscribe(listener: (key: Key) => void): () => void {
		this.listeners.add(listener)
		return () => {
			this.listeners.delete(listener)
		}
	}

	/** 广播按键；返回是否至少有一个订阅者（供调用方决定是否继续默认路由）。 */
	emit(key: Key): boolean {
		let handled = false
		for (const listener of this.listeners) {
			listener(key)
			handled = true
		}
		return handled
	}
}

export const KeyBusContext = createContext<KeyBus>()
