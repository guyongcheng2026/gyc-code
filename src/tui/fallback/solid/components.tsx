/** @jsxImportSource #fallback-solid */
import { createEffect, createMemo, createSignal, For } from "solid-js"
import { parseMarkdown } from "../markdown"
import { EditBuffer } from "../text/edit-buffer"
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
	/** 当前光标位置（光标口径：code point 索引，row 为行号，col 为字符列） */
	getCursor(): { row: number; col: number }
}

export interface TextareaProps {
	height?: number
	style?: LayoutProps["style"]
	onSubmit?: (text: string) => void
	/** 光标可见性（闪烁驱动：run-app 层 setInterval 切换；默认恒可见） */
	cursorVisible?: boolean
	/** 光标移动回调（绝对坐标：屏幕 row + col），用于驱动 IME 浮窗定位 */
	onCursorMove?: (row: number, col: number) => void
	/** 输入区在屏幕上的起始 row（用于把逻辑 row 折算成绝对 row） */
	screenOffsetRow?: number
	ref?: (api: TextareaApi) => void
}

export function Textarea(props: TextareaProps): JSX.Element {
	// M4：编辑状态由 EditBuffer 承载（undo/redo、kill、选择、extmarks），
	// 组件只负责把快照同步到渲染属性并路由按键。
	const buffer = new EditBuffer()
	const [view, setView] = createSignal({ lines: [""] as string[], row: 0, col: 0 })
	const sync = () => setView({ lines: [...buffer.linesSnapshot], row: buffer.cursor.row, col: buffer.cursor.col })

	const clear = () => {
		buffer.setText("")
		sync()
	}

	const api: TextareaApi = {
		handleKey(key: Key): boolean {
			switch (key.type) {
				case "text":
					buffer.insert(key.text.replace(/\r/g, ""))
					break
				case "paste":
					buffer.insert(key.text)
					break
				case "backspace":
					buffer.backspace()
					break
				case "enter": {
					if (props.onSubmit !== undefined) {
						const text = buffer.text
						if (text.trim().length > 0) props.onSubmit(text)
						buffer.setText("")
						sync()
						return true
					}
					buffer.insert("\n")
					break
				}
				case "left":
					if (key.modifiers?.shift === true) {
						if (!buffer.hasSelection) buffer.beginSelection()
					} else buffer.clearSelection()
					buffer.moveLeft()
					break
				case "right":
					if (key.modifiers?.shift === true) {
						if (!buffer.hasSelection) buffer.beginSelection()
					} else buffer.clearSelection()
					buffer.moveRight()
					break
				case "up":
					if (key.modifiers?.shift === true) {
						if (!buffer.hasSelection) buffer.beginSelection()
					} else buffer.clearSelection()
					buffer.moveUp()
					break
				case "down":
					if (key.modifiers?.shift === true) {
						if (!buffer.hasSelection) buffer.beginSelection()
					} else buffer.clearSelection()
					buffer.moveDown()
					break
				case "home":
					buffer.clearSelection()
					buffer.moveLineStart()
					break
				case "end":
					buffer.clearSelection()
					buffer.moveLineEnd()
					break
				case "ctrl": {
					const k = key.key
					if (k === "a") buffer.moveLineStart()
					else if (k === "e") buffer.moveLineEnd()
					else if (k === "k") buffer.killToLineEnd()
					else if (k === "u") buffer.killToLineStart()
					else if (k === "w") buffer.deleteWordBefore()
					else if (k === "z") buffer.undo()
					else if (k === "y") buffer.redo()
					else return false
					break
				}
				default:
					return false
			}
			sync()
			return true
		},
		getText: () => buffer.text,
		clear,
		getCursor: () => buffer.cursor,
	}
	props.ref?.(api)

	// 光标移动副作用：把「逻辑 row/col」折算为「屏幕绝对 row/col」上报，
	// 供 run-app 层把终端物理光标移动到对应位置，IME 浮窗自动跟随
	createEffect(() => {
		const c = view()
		if (props.onCursorMove) {
			const absRow = (props.screenOffsetRow ?? 0) + c.row
			props.onCursorMove(absRow, c.col)
		}
	})

	return (
		<textarea
			height={props.height}
			style={props.style}
			lines={view().lines}
			cursorRow={view().row}
			cursorCol={view().col}
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
