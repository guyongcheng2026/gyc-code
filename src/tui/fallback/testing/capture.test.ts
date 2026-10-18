import { describe, expect, test } from "bun:test"
import { Screen } from "../screen"
import { captureLines, captureSpans } from "./capture"

describe("captureSpans 带样式快照", () => {
	test("同样式连续单元格合并为单段，尾部空白另成段", () => {
		const s = new Screen(6, 1)
		s.writeText(0, 0, "abc", { fg: "#ff0000" })
		const spans = captureSpans(s).lines[0]?.spans ?? []
		// 行宽固定为 6：前 3 格带色，后 3 格是未着色的空白 → 两段
		expect(spans.length).toBe(2)
		expect(spans[0]?.text).toBe("abc")
		expect(spans[0]?.fg).toBe("#ff0000")
		expect(spans[0]?.width).toBe(3)
		expect(spans[1]?.text).toBe("   ")
		expect(spans[1]?.fg).toBeUndefined()
		expect(spans[1]?.width).toBe(3)
	})

	test("样式切换处切段", () => {
		const s = new Screen(4, 1)
		s.writeText(0, 0, "ab", { fg: "#111111" })
		s.writeText(2, 0, "cd", { fg: "#222222" })
		const spans = captureSpans(s).lines[0]?.spans ?? []
		expect(spans.map((span) => span.text)).toEqual(["ab", "cd"])
		expect(spans.map((span) => span.fg)).toEqual(["#111111", "#222222"])
	})

	test("属性按固定顺序输出", () => {
		const s = new Screen(2, 1)
		s.writeText(0, 0, "x", { underline: true, bold: true })
		expect(captureSpans(s).lines[0]?.spans[0]?.attributes).toEqual(["bold", "underline"])
	})

	test("宽字符占位格不产生空段，宽度按 2 累计", () => {
		const s = new Screen(6, 1)
		s.writeText(0, 0, "中文")
		const spans = captureSpans(s).lines[0]?.spans ?? []
		expect(spans.length).toBe(1)
		expect(spans[0]?.text).toBe("中文  ")
		expect(spans[0]?.width).toBe(6)
	})

	test("空白行压成单段全空格", () => {
		const s = new Screen(3, 1)
		const spans = captureSpans(s).lines[0]?.spans ?? []
		expect(spans.length).toBe(1)
		expect(spans[0]?.text).toBe("   ")
		expect(spans[0]?.attributes).toEqual([])
	})

	test("未设置颜色时 fg/bg 缺省", () => {
		const s = new Screen(1, 1)
		s.writeText(0, 0, "z")
		const span = captureSpans(s).lines[0]?.spans[0]
		expect(span?.fg).toBeUndefined()
		expect(span?.bg).toBeUndefined()
	})

	test("captureLines 还原可读文本", () => {
		const s = new Screen(8, 2)
		s.writeText(0, 0, "hello")
		s.writeText(0, 1, "中文")
		expect(captureLines(captureSpans(s))).toEqual(["hello   ", "中文    "])
	})
})
