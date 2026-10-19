import { createContext, createMemo, useContext, type Accessor } from "solid-js"
import { Keymap, type Binding, type KeymapCommand } from "./core"
import type { JSX } from "../solid/jsx-runtime"

/**
 * M7：keymap 的 Solid 接线（对齐产线 `src/tui/keymap.tsx:15` 用到的
 * `KeymapProvider` / `useKeymap` / `useBindings` / `useKeymapSelector`）。
 *
 * 差异：不提供 `useKeymapSelector` 的细粒度 store 订阅——这里用 `createMemo`
 * 派生；产线迁移时若依赖层订阅语义需另行适配。
 */

export interface KeymapContextValue {
	readonly keymap: Keymap
	dispatchCommand(command: string, args?: unknown): void
	getCommands(): readonly KeymapCommand[]
	getBindings(command: string): readonly Binding[]
}

export const KeymapContext = createContext<KeymapContextValue>()

export interface KeymapProviderProps {
	readonly keymap: Keymap
	/** 绑定表（数据来自 config/keybind，keymap.bind 的声明式入口） */
	readonly bindings?: readonly Binding[]
	readonly children?: unknown
}

/** 直接调用 Context.Provider（与 createComponent 等价，见 renderer.ts 的同类处理）。 */
export function KeymapProvider(props: KeymapProviderProps): JSX.Element {
	// 声明式绑定入口：传入即重建绑定树（与 keymap.bind 等价；编程式 bind 的调用方
	// 不要同时传 bindings，避免互相覆盖）
	if (props.bindings !== undefined) props.keymap.bind(...props.bindings)
	const value: KeymapContextValue = {
		keymap: props.keymap,
		dispatchCommand(command, args) {
			const command_ = props.keymap.getCommands().find((entry) => entry.name === command)
			command_?.run(args)
		},
		getCommands: () => props.keymap.getCommands(),
		getBindings: (command) => props.bindings?.filter((binding) => binding.command === command) ?? [],
	}
	const provider = KeymapContext.Provider as unknown as (props: {
		value: KeymapContextValue
		children: unknown
	}) => JSX.Element
	return provider({ value, get children() { return props.children } })
}

/** 当前 keymap 上下文；缺失时抛错（keymap 是应用级强依赖）。 */
export function useKeymap(): KeymapContextValue {
	const value = useContext(KeymapContext)
	if (value === undefined) throw new Error("useKeymap 必须在 KeymapProvider 内调用")
	return value
}

/** 派发命令（等价 `keymap.dispatchCommand` 的使用面）。 */
export function useDispatchCommand(): (command: string, args?: unknown) => void {
	return useKeymap().dispatchCommand
}

/** 某命令的全部绑定（供帮助/which-key 展示）。 */
export function useBindings(command: string): Accessor<readonly Binding[]> {
	const context = useKeymap()
	return createMemo(() => context.getBindings(command))
}

/** 从上下文派生只读视图。 */
export function useKeymapSelector<T>(selector: (context: KeymapContextValue) => T): Accessor<T> {
	const context = useKeymap()
	return createMemo(() => selector(context))
}
