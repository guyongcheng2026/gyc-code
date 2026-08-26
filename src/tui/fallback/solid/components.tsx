/** @jsxImportSource #fallback-solid */
import { createSignal } from "solid-js"
import type { Key } from "../input"
import type { ElementNode } from "./nodes"
import type { JSX, LayoutProps } from "./jsx-runtime"

/**
 * S1 组件桥接：三大件组件层。
 *
 * - Box/Text：intrinsic 薄封装（语义入口）
 * - ScrollBox：视口裁剪滚动（paint 层量算 contentHeight 并 clamp scrollTop）
 * - Textarea：多行编辑（逻辑行 + 逻辑光标；显示 wrap 与宽度安全由 paint 层负责）
 * - Input：Textarea 的提交特化（Enter 提交不换行）
 *
 * 键盘路由：组件不直接绑定 stdin——app 层持有 KeyParser，按键先给
 * 输入区（handleKey），未消费再给滚动区。
 */

export function Box(props: LayoutProps & { children?: unknown }): JSX.Element {
	return (
		<box width={props.width} height={props.height} flex={props.flex} style={props.style}>
			{props.children}
		</box>
	)
}

export function Text(props: LayoutProps & { children?: unknown }): JSX.Element {
	return (
		<text width={props.width} height={props.height} flex={props.flex} style={props.style}>
			{props.children}
		</text>
	)
}

export interface ScrollBoxApi {
	/** 相对滚动：正值向下翻 delta 行（基于 paint 后的实际 scrollTop） */
	scrollBy(delta: number): void
	/** 滚到底部（paint 阶段 clamp 到 maxScroll） */
	scrollToBottom(): void
}

export function ScrollBox(props: LayoutProps & { children?: unknown; ref?: (api: ScrollBoxApi) => void }): JSX.Element {
	let host: ElementNode | undefined
	const [scrollTop, setScrollTop] = createSignal(0)
	const api: ScrollBoxApi = {
		scrollBy(delta: number) {
			setScrollTop(Math.max(0, (host?.scrollTop ?? 0) + delta))
		},
		scrollToBottom() {
			setScrollTop(Number.POSITIVE_INFINITY)
		},
	}
	props.ref?.(api)
	return (
		<scrollbox
			width={props.width}
			height={props.height}
			flex={props.flex}
			style={props.style}
			scrollTop={scrollTop()}
			ref={(node) => {
				host = node as ElementNode
			}}
		>
			{props.children}
		</scrollbox>
	)
}

export interface TextareaApi {
	/** 处理按键；返回 true 表示已消费 */
	handleKey(key: Key): boolean
	getText(): string
	clear(): void
}

export interface TextareaProps {
	height?: number
	style?: LayoutProps["style"]
	onSubmit?: (text: string) => void
	/** 光标可见性（闪烁驱动：run-app 层 setInterval 切换；默认恒可见） */
	cursorVisible?: boolean
	ref?: (api: TextareaApi) => void
}

export function Textarea(props: TextareaProps): JSX.Element {
	const [lines, setLines] = createSignal<string[]>([""])
	const [cursor, setCursor] = createSignal({ row: 0, col: 0 })

	const clear = () => {
		setLines([""])
		setCursor({ row: 0, col: 0 })
	}

	const clampCursor = (row: number, col: number) => {
		const ls = lines()
		const r = Math.max(0, Math.min(row, ls.length - 1))
		// 行长按 code point 计（光标口径），代理对安全
		setCursor({ row: r, col: Math.max(0, Math.min(col, Array.from(ls[r] ?? "").length)) })
	}

	const api: TextareaApi = {
		handleKey(key: Key): boolean {
			const c = cursor()
			switch (key.type) {
			case "text": {
				const text = key.text.replace(/\r/g, "")
				if (text.length === 0) return true
				const ls = [...lines()]
				const chars = Array.from(ls[c.row] ?? "")
				const before = chars.slice(0, c.col).join("")
				const after = chars.slice(c.col).join("")
				const segments = text.split("\n")
				if (segments.length === 1) {
					ls[c.row] = before + text + after
					setLines(ls)
					setCursor({ row: c.row, col: c.col + Array.from(text).length })
					return true
				}
				// 多行插入（粘贴/API 直调）：首段接光标前，末段带走光标后内容
				ls[c.row] = before + segments[0]!
				for (let i = 1; i < segments.length; i++) {
					const tail = i === segments.length - 1 ? segments[i]! + after : segments[i]!
					ls.splice(c.row + i, 0, tail)
				}
				setLines(ls)
				const last = segments[segments.length - 1]!
				setCursor({ row: c.row + segments.length - 1, col: Array.from(last).length })
				return true
			}
				case "backspace": {
					const ls = [...lines()]
					if (c.col > 0) {
						const chars = Array.from(ls[c.row] ?? "")
						chars.splice(c.col - 1, 1)
						ls[c.row] = chars.join("")
						setLines(ls)
						setCursor({ row: c.row, col: c.col - 1 })
					} else if (c.row > 0) {
						const prev = ls[c.row - 1] ?? ""
						const cur = ls[c.row] ?? ""
						ls.splice(c.row - 1, 2, prev + cur)
						setLines(ls)
						setCursor({ row: c.row - 1, col: Array.from(prev).length })
					}
					return true
				}
				case "enter": {
					if (props.onSubmit !== undefined) {
						const text = lines().join("\n")
						if (text.trim().length > 0) props.onSubmit(text)
						clear()
						return true
					}
					const ls = [...lines()]
					const chars = Array.from(ls[c.row] ?? "")
					ls[c.row] = chars.slice(0, c.col).join("")
					ls.splice(c.row + 1, 0, chars.slice(c.col).join(""))
					setLines(ls)
					setCursor({ row: c.row + 1, col: 0 })
					return true
				}
				case "left": {
					if (c.col > 0) setCursor({ row: c.row, col: c.col - 1 })
					else if (c.row > 0) clampCursor(c.row - 1, Number.MAX_SAFE_INTEGER)
					return true
				}
				case "right": {
					const lineLen = Array.from(lines()[c.row] ?? "").length
					if (c.col < lineLen) setCursor({ row: c.row, col: c.col + 1 })
					else if (c.row < lines().length - 1) clampCursor(c.row + 1, 0)
					return true
				}
				case "up":
					clampCursor(c.row - 1, c.col)
					return true
				case "down":
					clampCursor(c.row + 1, c.col)
					return true
				case "home":
					setCursor({ row: c.row, col: 0 })
					return true
				case "end":
					setCursor({ row: c.row, col: Array.from(lines()[c.row] ?? "").length })
					return true
				default:
					return false
			}
		},
		getText: () => lines().join("\n"),
		clear,
	}
	props.ref?.(api)

	return (
		<textarea
			height={props.height}
			style={props.style}
			lines={lines()}
			cursorRow={cursor().row}
			cursorCol={cursor().col}
			cursorVisible={props.cursorVisible}
		/>
	)
}

/** Input：Textarea 提交特化——Enter 提交并清空，不插入换行。 */
export function Input(props: Omit<TextareaProps, "onSubmit"> & { onSubmit: (text: string) => void }): JSX.Element {
	return Textarea({ ...props }) as JSX.Element
}
