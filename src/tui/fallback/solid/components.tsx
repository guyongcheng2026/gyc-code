/** @jsxImportSource #fallback-solid */
import { createMemo, createSignal, For } from "solid-js"
import { parseMarkdown } from "../markdown"
import type { Key } from "../input"
import type { ElementNode } from "./nodes"
import { textDisplayWidth } from "./paint"
import type { JSX, LayoutProps, SpanProp } from "./jsx-runtime"

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
		<box
			width={props.width}
			height={props.height}
			flex={props.flex}
			direction={props.direction}
			gap={props.gap}
			padding={props.padding}
			border={props.border}
			style={props.style}
		>
			{props.children}
		</box>
	)
}

export function Text(props: LayoutProps & { spans?: SpanProp[]; children?: unknown }): JSX.Element {
	return (
		<text width={props.width} height={props.height} flex={props.flex} style={props.style} spans={props.spans}>
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

export interface MarkdownProps {
	/** Markdown 源文本 */
	source: string
	style?: LayoutProps["style"]
}

/**
 * Markdown 渲染组件（parity slice A）：解析为富文本行（StyledSpan[]），
 * 每行渲染为一个 spans 驱动的 text 元素。解析结果 memo 化——source 不变不重解析。
 */
export function Markdown(props: MarkdownProps): JSX.Element {
	const lines = createMemo(() => parseMarkdown(props.source))
	return (
		<box style={props.style}>
			<For each={lines()}>{(spans) => <text spans={spans as SpanProp[]} />}</For>
		</box>
	)
}

// ---------- slice B：Select / ScrollBar / TextTable ----------

export interface SelectApi {
	/** 处理按键；返回 true 表示已消费（上下/回车/Esc） */
	handleKey(key: Key): boolean
	/** 当前选中索引 */
	selectedIndex(): number
}

export interface SelectProps {
	/** 选项文本列表 */
	options: string[]
	/** 视口可见行数（缺省全部） */
	visibleRows?: number
	/** 选中变化回调 */
	onChange?: (index: number) => void
	/** 回车确认回调 */
	onConfirm?: (index: number) => void
	/** Esc 取消回调 */
	onCancel?: () => void
	style?: LayoutProps["style"]
	ref?: (api: SelectApi) => void
}

/**
 * Select 选择器（slice B）：上下移动 + 回车确认 + Esc 取消，
 * 选中项反白高亮，超视口自动滚动跟随（对齐 opentui Select 核心行为）。
 */
export function Select(props: SelectProps): JSX.Element {
	const [index, setIndex] = createSignal(0)
	const [offset, setOffset] = createSignal(0)
	const visible = () => props.visibleRows ?? props.options.length
	const options = () => props.options

	const clampView = (i: number) => {
		const v = visible()
		// 选中项强制保持在视口内
		if (i < offset()) setOffset(i)
		else if (i >= offset() + v) setOffset(i - v + 1)
	}

	const move = (delta: number) => {
		const next = Math.max(0, Math.min(index() + delta, options().length - 1))
		if (next === index()) return
		setIndex(next)
		clampView(next)
		props.onChange?.(next)
	}

	const api: SelectApi = {
		handleKey(key: Key): boolean {
			switch (key.type) {
				case "up":
					move(-1)
					return true
				case "down":
					move(1)
					return true
				case "pageup":
					move(-visible())
					return true
				case "pagedown":
					move(visible())
					return true
				case "home":
					move(-options().length)
					return true
				case "end":
					move(options().length)
					return true
				case "enter":
					props.onConfirm?.(index())
					return true
				case "escape":
					props.onCancel?.()
					return true
				default:
					return false
			}
		},
		selectedIndex: () => index(),
	}
	props.ref?.(api)

	return (
		<box style={props.style}>
			<For each={options().slice(offset(), offset() + visible())}>
				{(option, i) => (
					<text style={offset() + i() === index() ? { reverse: true } : {}}>{option}</text>
				)}
			</For>
		</box>
	)
}

/**
 * ScrollBar 滚动指示条（slice B）：竖直比例条——每行一个字符（█ 滑块 / │ 轨道），
 * 滑块长度与位置由 内容高/视口高/滚动位 比例计算。
 * 与 ScrollBox 组合使用（对齐 opentui ScrollBar 的视觉职责，不含交互）。
 */
export function ScrollBar(props: { contentHeight: number; viewportHeight: number; scrollTop: number }): JSX.Element {
	const track = () => Math.max(1, props.viewportHeight)
	const barLen = () => {
		if (props.contentHeight <= 0) return 1
		return Math.max(1, Math.round((props.viewportHeight / props.contentHeight) * track()))
	}
	const barPos = () => {
		const max = track() - barLen()
		if (max <= 0) return 0
		const maxScroll = Math.max(1, props.contentHeight - props.viewportHeight)
		return Math.min(max, Math.round((props.scrollTop / maxScroll) * max))
	}
	// 竖直轨道：每行一格（For 逐行 text，行内单字符 spans）
	return (
		<box>
			<For each={Array.from({ length: track() }, (_, i) => i)}>
				{(i) => (
					<text
						spans={[
							{
								text: i >= barPos() && i < barPos() + barLen() ? "█" : "│",
								style: i >= barPos() && i < barPos() + barLen() ? { fg: "#6a737d" } : { fg: "#d0d7de" },
							},
						]}
					/>
				)}
			</For>
		</box>
	)
}

export interface TextTableProps {
	/** 表头（首行加粗+下划线） */
	header?: string[]
	/** 数据行 */
	rows: string[][]
	style?: LayoutProps["style"]
}

/**
 * TextTable 表格（slice B）：列宽按列内容最大显示宽 + 2 空格分隔，
 * 宽字符安全（display-width 口径）。对齐 opentui TextTable 的基础呈现。
 */
export function TextTable(props: TextTableProps): JSX.Element {
	const table = createMemo(() => {
		const all = [props.header ?? [], ...props.rows]
		const widths: number[] = []
		for (const row of all) {
			row.forEach((cell, i) => {
				widths[i] = Math.max(widths[i] ?? 0, textDisplayWidth(cell))
			})
		}
		return { widths }
	})
	const padCell = (cell: string, i: number) => cell + " ".repeat(Math.max(1, (table().widths[i] ?? 0) - textDisplayWidth(cell) + 2))

	return (
		<box style={props.style}>
			{props.header ? (
				<text style={{ bold: true, underline: true }}>{props.header.map((h, i) => padCell(h, i)).join("")}</text>
			) : null}
			<For each={props.rows}>{(row) => <text>{row.map((cell, i) => padCell(cell, i)).join("")}</text>}</For>
		</box>
	)
}
