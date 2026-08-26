import type { CellStyle } from "../screen"
import type { FallbackNode } from "./nodes"
import { createComponent, createElement, spread } from "./renderer"
import type { JSX as SolidJSX } from "solid-js"

/**
 * S1 组件桥接：JSX 类型入口（对齐 @opentui/solid 的 jsx-runtime 布局）。
 *
 * babel universal 产物直接 import 运行时函数（见 index.ts）；
 * 本模块主要服务 TS 的 jsxImportSource 类型检查（fallback 目录的 .tsx
 * 文件头部标注 jsxImportSource pragma 指向本模块，见 tsconfig paths）。
 */

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function normalizeProps(props: any): Record<string, unknown> {
	if (!props) return {}
	if (!("key" in props)) return props
	const { key: _key, ...rest } = props
	return rest
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function createIntrinsicElement(type: string, props: Record<string, unknown>): FallbackNode {
	const element = createElement(type)
	spread(element, props)
	return element
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function jsx(type: string | ((props: any) => unknown), props: any = {}): JSX.Element {
	const normalized = normalizeProps(props)
	if (typeof type === "function") {
		return (() => createComponent(type as (p: unknown) => FallbackNode, normalized)) as unknown as JSX.Element
	}
	return createIntrinsicElement(type, normalized) as unknown as JSX.Element
}

export const jsxs = jsx

export function jsxDEV(
	// eslint-disable-next-line @typescript-eslint/no-explicit-any
	type: string | ((props: any) => unknown),
	// eslint-disable-next-line @typescript-eslint/no-explicit-any
	props: any = {},
): JSX.Element {
	return jsx(type, props)
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function Fragment(props: { children?: any }): unknown {
	return props.children ?? null
}

/** 公共布局样式属性（全部 intrinsic 元素通用）。 */
export interface LayoutProps {
	/** 显式宽度（列数）；缺省继承父宽 */
	width?: number
	/** 显式高度（行数）；缺省按内容自适应 */
	height?: number
	/** 父级高度有界时瓜分剩余空间 */
	flex?: boolean
	/** 主轴方向：column（默认，纵向堆叠）| row（横向排列） */
	direction?: "row" | "column"
	/** 子元素间距（沿主轴） */
	gap?: number
	/** 内边距（四边同值） */
	padding?: number
	/** 边框：true=single | "single" | "double"（内容自动内缩 1 格） */
	border?: boolean | "single" | "double"
	/** 文本/单元格样式 */
	style?: CellStyle
	children?: unknown
}

export interface BoxProps extends LayoutProps {}

export interface SpanProp {
	text: string
	style?: CellStyle
}

export interface TextProps extends LayoutProps {
	/** 富文本行内段（与纯文本 children 互斥；spans 优先） */
	spans?: SpanProp[]
}

export interface ScrollBoxProps extends LayoutProps {
	/** 滚动偏移（paint 阶段 clamp 到 [0, contentHeight - viewportH]） */
	scrollTop?: number
	/** 元素挂载回调（renderer 的 ref 特判） */
	ref?: (node: FallbackNode) => void
}

export interface TextareaProps extends LayoutProps {
	/** 逻辑行内容 */
	lines?: string[]
	/** 光标位置（逻辑行/列） */
	cursorRow?: number
	cursorCol?: number
	/** 光标可见性（闪烁的"灭"相位传 false） */
	cursorVisible?: boolean
	/** 元素挂载回调（renderer 的 ref 特判） */
	ref?: (node: FallbackNode) => void
}

export namespace JSX {
	export type Element = SolidJSX.Element
	export interface ElementChildrenAttribute {
		children: {}
	}
	export interface IntrinsicElements {
		box: BoxProps
		text: TextProps
		scrollbox: ScrollBoxProps
		textarea: TextareaProps
	}
}
