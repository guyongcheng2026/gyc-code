import { describe, expect, test } from "bun:test"
import { parseInline, parseMarkdown } from "./markdown"

function plain(lines: ReturnType<typeof parseMarkdown>): string[] {
	return lines.map((spans) => spans.map((span) => span.text).join(""))
}

describe("Markdown：基础块", () => {
	test("标题、列表、引用、代码块", () => {
		const lines = plain(
			parseMarkdown(["# 标题", "", "- 项目", "> 引用", "```ts", "const a = 1", "```"].join("\n")),
		)
		expect(lines[0]).toBe("标题")
		expect(lines[2]).toBe("  • 项目")
		expect(lines[3]).toBe("│ 引用")
		expect(lines[4]).toBe("┌ ts")
		expect(lines[5]?.startsWith("│ const")).toBe(true)
		expect(lines[6]).toBe("└")
	})

	test("分隔线与空行", () => {
		const lines = plain(parseMarkdown("---\n\ntext"))
		expect(lines[0]).toBe("─".repeat(64))
		expect(lines[1]).toBe("")
		expect(lines[2]).toBe("text")
	})
})

describe("Markdown：GFM 扩展", () => {
	test("表格渲染为网格并对齐列宽", () => {
		const source = ["| 名称 | 值 |", "| --- | --- |", "| a | 1 |", "| bb | 22 |"].join("\n")
		const lines = plain(parseMarkdown(source))
		expect(lines[0]).toBe("┌──────┬────┐")
		expect(lines[1]).toBe("│ 名称 │ 值 │")
		expect(lines[2]).toBe("├──────┼────┤")
		expect(lines[3]).toBe("│ a    │ 1  │")
		expect(lines[4]).toBe("│ bb   │ 22 │")
		expect(lines[5]).toBe("└──────┴────┘")
	})

	test("任务列表渲染为复选框", () => {
		const lines = plain(parseMarkdown("- [ ] 未完成\n- [x] 已完成"))
		expect(lines[0]).toBe("  ☐ 未完成")
		expect(lines[1]).toBe("  ☑ 已完成")
	})

	test("链接渲染为文本（下划线样式）", () => {
		const spans = parseInline("见 [文档](https://example.com) 说明", {})
		expect(spans.map((s) => s.text).join("")).toBe("见 文档 说明")
		expect(spans[1]?.style.underline).toBe(true)
	})

	test("嵌套列表按缩进加层级", () => {
		const lines = plain(parseMarkdown("- 一级\n  - 二级\n    - 三级"))
		expect(lines[0]).toBe("  • 一级")
		expect(lines[1]).toBe("    • 二级")
		expect(lines[2]).toBe("      • 三级")
	})

	test("有序列表保留序号", () => {
		const lines = plain(parseMarkdown("1. 第一步\n2. 第二步"))
		expect(lines[0]).toBe("  1. 第一步")
		expect(lines[1]).toBe("  2. 第二步")
	})
})

describe("Markdown：行内标记", () => {
	test("粗体/斜体/代码/删除线", () => {
		const spans = parseInline("**b** *i* `c` ~~s~~", {})
		expect(spans.map((s) => s.text).join("")).toBe("b i c s")
		expect(spans.find((s) => s.text === "b")?.style.bold).toBe(true)
		expect(spans.find((s) => s.text === "i")?.style.italic).toBe(true)
		expect(spans.find((s) => s.text === "c")?.style.fg).toBe("#22863a")
		expect(spans.find((s) => s.text === "s")?.style.strikethrough).toBe(true)
	})
})
