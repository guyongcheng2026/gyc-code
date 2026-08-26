import type { CellStyle } from "./screen"
import type { StyledSpan } from "./solid/paint"
import { highlightCodeLine } from "./highlight"

/**
 * parity slice A：最小 Markdown 解析器（零依赖，逐行扫描 + 行内标记）。
 *
 * 目标：AI 回复的核心 Markdown 子集渲染——不追求 CommonMark 完整性。
 *
 * 块级：标题（#~######）、代码块（``` fence）、无序列表（-/*）、
 * 有序列表（N.）、引用（>）、分隔线（---）、空行、段落。
 * 行内：**粗体**、*斜体*、`代码`、~~删除线~~。
 *
 * 输出：StyledSpan[][]（每行一组段；样式为具体值，渲染端与 base 合并）。
 */

/** Markdown 渲染默认配色（GitHub 暗色近似，与 rich-text.ts DEFAULT_PALETTE 同源）。 */
export const MD_STYLES = {
	heading: { bold: true, fg: "#005cc5" },
	quote: { fg: "#6a737d" },
	code: { fg: "#22863a" },
	list: { fg: "#24292e" },
} as const satisfies Record<string, CellStyle>

export type MarkdownLine = StyledSpan[]

export function parseMarkdown(source: string): MarkdownLine[] {
	const lines = source.split("\n")
	const out: MarkdownLine[] = []
	let inFence = false
	let fenceLang = ""

	for (const raw of lines) {
		// 代码块 fence 切换
		if (raw.trimStart().startsWith("```")) {
			if (!inFence) {
				inFence = true
				fenceLang = raw.trim().slice(3).trim()
				out.push([{ text: fenceLang ? `┌ ${fenceLang}` : "┌", style: MD_STYLES.quote }])
			} else {
				inFence = false
				out.push([{ text: "└", style: MD_STYLES.quote }])
			}
			continue
		}
		if (inFence) {
			// 代码块体：通用语法高亮（零原生依赖，见 highlight.ts）
			const highlighted = highlightCodeLine(raw, fenceLang)
			out.push([{ text: "│ ", style: MD_STYLES.quote }, ...highlighted])
			continue
		}

		const trimmed = raw.trim()
		// 空行
		if (trimmed.length === 0) {
			out.push([])
			continue
		}
		// 分隔线（--- / *** / ___）
		if (/^([-*_])\1{2,}$/.test(trimmed)) {
			out.push([{ text: "─".repeat(64), style: MD_STYLES.quote }])
			continue
		}
		// 标题
		const heading = /^(#{1,6})\s+(.*)$/.exec(trimmed)
		if (heading) {
			out.push(parseInline(heading[2]!, MD_STYLES.heading))
			continue
		}
		// 无序列表
		const bullet = /^[-*+]\s+(.*)$/.exec(trimmed)
		if (bullet) {
			out.push([{ text: "  • ", style: MD_STYLES.list }, ...parseInline(bullet[1]!, {})])
			continue
		}
		// 有序列表
		const ordered = /^(\d+)[.)]\s+(.*)$/.exec(trimmed)
		if (ordered) {
			out.push([{ text: `  ${ordered[1]}. `, style: MD_STYLES.list }, ...parseInline(ordered[2]!, {})])
			continue
		}
		// 引用
		const quote = /^>\s?(.*)$/.exec(trimmed)
		if (quote) {
			out.push([{ text: "│ ", style: MD_STYLES.quote }, ...parseInline(quote[1]!, MD_STYLES.quote)])
			continue
		}
		// 普通段落
		out.push(parseInline(trimmed, {}))
	}
	// 尾部 fence 未闭合：补一条底线保持视觉对称
	if (inFence) out.push([{ text: "└", style: MD_STYLES.quote }])
	return out
}

/** 行内标记解析：**粗体** / *斜体* / `代码` / ~~删除线~~。 */
export function parseInline(line: string, base: CellStyle): StyledSpan[] {
	if (line.length === 0) return [{ text: "", style: base }]
	const spans: StyledSpan[] = []
	const re = /\*\*(.+?)\*\*|\*(.+?)\*|`([^`]+)`|~~(.+?)~~/g
	let lastIndex = 0
	let m: RegExpExecArray | null
	while ((m = re.exec(line)) !== null) {
		if (m.index > lastIndex) spans.push({ text: line.slice(lastIndex, m.index), style: base })
		if (m[1] !== undefined) spans.push({ text: m[1], style: { ...base, bold: true } })
		else if (m[2] !== undefined) spans.push({ text: m[2], style: { ...base, italic: true } })
		else if (m[3] !== undefined) spans.push({ text: m[3], style: { ...base, ...MD_STYLES.code } })
		else if (m[4] !== undefined) spans.push({ text: m[4], style: { ...base, strikethrough: true } })
		lastIndex = re.lastIndex
	}
	if (lastIndex < line.length) spans.push({ text: line.slice(lastIndex), style: base })
	return spans
}
