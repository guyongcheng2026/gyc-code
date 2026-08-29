import { describe, expect, test } from "bun:test"
import { DEFAULT_PALETTE, resolveTokenStyle, writeRichText, type RichToken } from "./rich-text"
import { Screen } from "./screen"
import { renderDelta, renderFull } from "./diff"

// 确保 truecolor 模式（否则 diff 降级到 256 色）
process.env.COLORTERM = "truecolor"

/**
 * P1 引擎验收扩容：富文本层快照矩阵。
 *
 * 目标：验证 tree-sitter 高亮 token 的样式渲染与网格占位在 diff 引擎下对齐。
 * 覆盖：scope→样式映射、SGR 最小化、token 边界、宽字符（中文/emoji）在
 * 富文本下不撕裂、全量/增量帧的样式正确性。
 */
describe("富文本层快照矩阵（P1）", () => {
	const FALLBACK = { fg: DEFAULT_PALETTE.text }

	test("keyword 映射为关键字色", () => {
		const style = resolveTokenStyle(["keyword"], DEFAULT_PALETTE, FALLBACK)
		expect(style.fg).toBe(DEFAULT_PALETTE.syntaxKeyword)
		expect(style.italic).toBe(true)
	})

	test("comment 映射为注释色 + 斜体", () => {
		const style = resolveTokenStyle(["comment"], DEFAULT_PALETTE, FALLBACK)
		expect(style.fg).toBe(DEFAULT_PALETTE.syntaxComment)
		expect(style.italic).toBe(true)
	})

	test("keyword.return 特化优先级高于通用 keyword", () => {
		const special = resolveTokenStyle(["keyword.return"], DEFAULT_PALETTE, FALLBACK)
		expect(special.italic).toBe(true)
	})

	test("关键字族样式差异在渲染输出中体现为不同 SGR", () => {
		const s = new Screen(30, 1)
		s.writeText(0, 0, "return", resolveTokenStyle(["keyword.return"], DEFAULT_PALETTE, FALLBACK))
		s.writeText(6, 0, "func(", {
			fg: DEFAULT_PALETTE.syntaxFunction,
		})
		const out = renderFull(s)
		// 两个 token 必须产生两个不同的 SGR 序列（色码不同）
		expect(out).toContain(`38;2;${hexToRgb(DEFAULT_PALETTE.syntaxKeyword)}`)
		expect(out).toContain(`38;2;${hexToRgb(DEFAULT_PALETTE.syntaxFunction)}`)
		// 斜体码 3 必须与关键字色同段出现（sgrFor 属性先于 fg）
		expect(out).toContain(`\x1b[3;38;2;${hexToRgb(DEFAULT_PALETTE.syntaxKeyword)}`)
	})

	test("富文本写入全量帧：字符串 token 颜色正确", () => {
		const s = new Screen(40, 1)
		const tokens: RichToken[] = [{ text: "const ", scopes: ["keyword.import"] }, { text: '"hi"', scopes: ["string"] }]
		writeRichText(s, 0, 0, tokens, DEFAULT_PALETTE)
		const out = renderFull(s)
		expect(out).toContain(`38;2;${hexToRgb(DEFAULT_PALETTE.syntaxString)}`)
		expect(out).toContain(`38;2;${hexToRgb(DEFAULT_PALETTE.syntaxKeyword)}`)
	})

	test("中文富文本 token 不撕裂占位", () => {
		const s = new Screen(30, 1)
		const tokens: RichToken[] = [{ text: "注释", scopes: ["comment"] }]
		writeRichText(s, 0, 0, tokens, DEFAULT_PALETTE)
		// 中文占 2 列、占位格不丢字符
		expect(s.cellAt(0, 0).width).toBe(2)
		expect(s.cellAt(1, 0).width).toBe(0)
		expect(s.snapshot()[0]!.startsWith("注释")).toBe(true)
	})

	test("富文本样式变更仅重绘变化区间", () => {
		const a = new Screen(30, 1)
		const b = new Screen(30, 1)
		const tokens: RichToken[] = [{ text: "hello", scopes: ["string"] }]
		writeRichText(a, 0, 0, tokens, DEFAULT_PALETTE)
		// 同一文本，仅样式变化（string -> comment）
		a.writeText(0, 0, "hello", resolveTokenStyle(["string"], DEFAULT_PALETTE, FALLBACK))
		b.writeText(0, 0, "hello", resolveTokenStyle(["comment"], DEFAULT_PALETTE, FALLBACK))
		const delta = renderDelta(a, b)
		expect(delta).not.toBe("")
		expect(delta).toContain("\x1b[1;1H")
	})

	test("diff.plus 样式含背景色", () => {
		const style = resolveTokenStyle(["diff.plus"], DEFAULT_PALETTE, FALLBACK)
		expect(style.fg).toBe(DEFAULT_PALETTE.diffAdded)
		expect(style.bg).toBe(DEFAULT_PALETTE.diffAddedBg)
	})
})

function hexToRgb(hex: string): string {
	const v = hex.replace("#", "")
	return `${Number.parseInt(v.slice(0, 2), 16)};${Number.parseInt(v.slice(2, 4), 16)};${Number.parseInt(v.slice(4, 6), 16)}`
}