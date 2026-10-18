import type { CellStyle } from "./screen"
import { textDisplayWidth, type StyledSpan } from "./solid/paint"
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

/** 表格分隔行：`| --- | :--: |` */
function isTableSeparator(line: string): boolean {
	return /^\s*\|[\s:|-]+\|\s*$/.test(line) && line.includes("-")
}

/** 表格数据行：`| a | b |` */
function isTableRow(line: string): boolean {
	return /^\s*\|.*\|\s*$/.test(line)
}

function splitTableRow(line: string): string[] {
	const body = line.trim().replace(/^\|/, "").replace(/\|$/, "")
	return body.split("|").map((cell) => cell.trim())
}

/**
 * 渲染 GFM 表格为网格（对齐产线 `<markdown tableOptions={{ style: "grid" }}>`）。
 * 列宽取该列最大显示宽，宽字符安全。
 */
function renderTable(header: string[], rows: string[][]): MarkdownLine[] {
	const cols = Math.max(header.length, ...rows.map((row) => row.length), 1)
	const widths: number[] = []
	for (let i = 0; i < cols; i++) {
		let width = textDisplayWidth(header[i] ?? "")
		for (const row of rows) width = Math.max(width, textDisplayWidth(row[i] ?? ""))
		widths[i] = width
	}
	const pad = (text: string, width: number) => text + " ".repeat(Math.max(0, width - textDisplayWidth(text)))
	const cells = (row: string[]) => "│ " + widths.map((w, i) => pad(row[i] ?? "", w)).join(" │ ") + " │"
	const rule = (left: string, mid: string, right: string) =>
		left + widths.map((w) => "─".repeat(w + 2)).join(mid) + right

	return [
		[{ text: rule("┌", "┬", "┐"), style: MD_STYLES.quote }],
		[{ text: cells(header), style: MD_STYLES.heading }],
		[{ text: rule("├", "┼", "┤"), style: MD_STYLES.quote }],
		...rows.map((row) => [{ text: cells(row), style: MD_STYLES.list }]),
		[{ text: rule("└", "┴", "┘"), style: MD_STYLES.quote }],
	]
}

export function parseMarkdown(source: string): MarkdownLine[] {
	const lines = source.split("\n")
	const out: MarkdownLine[] = []
	let inFence = false
	let fenceLang = ""

	for (let index = 0; index < lines.length; index++) {
		const raw = lines[index]!
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

		// 表格：当前行是数据行且下一行是分隔行
		if (isTableRow(raw) && index + 1 < lines.length && isTableSeparator(lines[index + 1]!)) {
			const header = splitTableRow(raw)
			const rows: string[][] = []
			let cursor = index + 2
			while (cursor < lines.length && isTableRow(lines[cursor]!)) {
				rows.push(splitTableRow(lines[cursor]!))
				cursor += 1
			}
			out.push(...renderTable(header, rows))
			index = cursor - 1
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
		// 任务列表（GFM）：- [ ] / - [x]
		const task = /^[-*+]\s+\[([ xX])\]\s+(.*)$/.exec(trimmed)
		if (task) {
			const checked = task[1] !== " "
			out.push([
				{ text: checked ? "  ☑ " : "  ☐ ", style: MD_STYLES.list },
				...parseInline(task[2]!, checked ? { dim: true } : {}),
			])
			continue
		}
		// 列表：按缩进层级加前缀（2 空格一级，最多 4 级）
		const listMatch = /^(\s*)([-*+]|\d+[.)])\s+(.*)$/.exec(raw)
		if (listMatch) {
			const level = Math.min(4, Math.floor((listMatch[1]?.length ?? 0) / 2))
			const ordered = /^\d/.test(listMatch[2]!)
			const marker = ordered ? `${listMatch[2]!.replace(/[.)]$/, "")}. ` : "• "
			out.push([
				{ text: "  ".repeat(level + 1) + marker, style: MD_STYLES.list },
				...parseInline(listMatch[3]!, {}),
			])
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

/** 行内标记解析：**粗体** / *斜体* / `代码` / ~~删除线~~ / [链接](url)。 */
export function parseInline(line: string, base: CellStyle): StyledSpan[] {
	if (line.length === 0) return [{ text: "", style: base }]
	const spans: StyledSpan[] = []
	const re = /\*\*(.+?)\*\*|\*(.+?)\*|`([^`]+)`|~~(.+?)~~|\[([^\]]+)\]\(([^)]+)\)/g
	let lastIndex = 0
	let m: RegExpExecArray | null
	while ((m = re.exec(line)) !== null) {
		if (m.index > lastIndex) spans.push({ text: line.slice(lastIndex, m.index), style: base })
		if (m[1] !== undefined) spans.push({ text: m[1], style: { ...base, bold: true } })
		else if (m[2] !== undefined) spans.push({ text: m[2], style: { ...base, italic: true } })
		else if (m[3] !== undefined) spans.push({ text: m[3], style: { ...base, ...MD_STYLES.code } })
		else if (m[4] !== undefined) spans.push({ text: m[4], style: { ...base, strikethrough: true } })
		else if (m[5] !== undefined) {
			// 链接：终端无跳转能力，按"文本 + 下划线"呈现（对齐 opentui <a>）
			spans.push({ text: m[5], style: { ...base, underline: true } })
		}
		lastIndex = re.lastIndex
	}
	if (lastIndex < line.length) spans.push({ text: line.slice(lastIndex), style: base })
	return spans
}
