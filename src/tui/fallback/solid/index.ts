/**
 * S1 组件桥接：fallback Solid 运行时入口。
 *
 * babel universal 产物（bun-solid-plugin 按路径分流）import 的运行时函数
 * 全部来自本模块（#fallback-solid 别名，见 package.json imports）。
 * builtIns（For/Show/Switch/...）从 solid-js 原样 re-export，与
 * solid-js/web 在 DOM 生态中的角色对等。
 *
 * 注意：solid-js 的 dist/solid.js（经插件统一重定向）不含 Dynamic，
 * 此处提供 universal 等价实现（对齐 @opentui/solid 的 createDynamic）。
 */
import { createComponent as solidCreateComponent, createMemo, splitProps } from "solid-js"
import type { JSX as SolidJSX } from "solid-js"
import { solidRenderer } from "./renderer"

export const { createComponent, createElement, createTextNode, insert, insertNode, spread, setProp, use, mergeProps, effect, memo } =
	solidRenderer

export { renderRoot, flushSync } from "./renderer"

// 组件层（三大件 + slice B 常用件）
export { Box, Text, ScrollBox, Textarea, Input, Markdown, Select, ScrollBar, TextTable } from "./components"
export type { ScrollBoxApi, TextareaApi, TextareaProps, MarkdownProps, SelectApi, SelectProps, TextTableProps } from "./components"

// solid-js builtIns：universal 产物直接从 moduleName import
export {
	For,
	Show,
	Switch,
	Match,
	Index,
	ErrorBoundary,
	Suspense,
	createSignal,
	createEffect,
	createMemo,
	on,
	onMount,
	onCleanup,
	batch,
	splitProps,
} from "solid-js"

/** universal Dynamic：函数组件走 createComponent，字符串走 intrinsic。 */
export function Dynamic(props: Record<string, unknown> & { component: unknown }): unknown {
	const [p, others] = splitProps(props, ["component"])
	return createMemo(() => {
		const component = p.component
		if (typeof component === "function") {
			return solidCreateComponent(
				component as (p: Record<string, unknown>) => SolidJSX.Element,
				others,
			) as unknown
		}
		if (typeof component === "string") {
			const element = createElement(component)
			spread(element, others)
			return element
		}
		return undefined
	})
}
