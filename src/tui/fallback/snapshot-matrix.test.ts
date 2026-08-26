import { describe, expect, test } from "bun:test"
import stringWidth from "string-width"
import { Screen } from "./screen"
import { renderDelta, renderFull } from "./diff"

/**
 * 乱码专项快照矩阵：覆盖 CJK、emoji、组合字符、混排场景，
 * 断言网格占位与差分输出的正确性。
 */
describe("乱码专项快照矩阵", () => {
	test("基本 CJK 汉字", () => {
		const s = new Screen(10, 1)
		s.writeText(0, 0, "编码测试")
		expect(s.snapshot()[0]).toBe("编码测试  ")
	})

	test("常用 emoji 占 2 列", () => {
		const s = new Screen(10, 1)
		s.writeText(0, 0, "🚀ok")
		const line = s.snapshot()[0]!
		expect(line.startsWith("🚀")).toBe(true)
		expect(s.cellAt(0, 0).width).toBe(2)
		expect(s.cellAt(1, 0).width).toBe(0)
		expect(s.cellAt(2, 0).ch).toBe("o")
	})

	test("CJK 与半角混排对齐", () => {
		const s = new Screen(20, 1)
		s.writeText(0, 0, "gyc-code 自研渲染器")
		// 显示列宽累加（占位格计入 1 列），不得超过网格宽度
		const displayCols = Array.from({ length: 20 }, (_, x) => s.cellAt(x, 0).width as number).reduce(
			(a, b) => a + b,
			0,
		)
		expect(displayCols).toBeLessThanOrEqual(20)
		expect(s.cellAt(0, 0).ch).toBe("g")
	})

	test("全角标点与中文混排", () => {
		const s = new Screen(12, 1)
		s.writeText(0, 0, "「测试」，ok")
		expect(s.cellAt(0, 0).width).toBe(2)
		expect(s.snapshot()[0]).toContain("「测试」")
	})

	test("韩文宽字符", () => {
		const s = new Screen(8, 1)
		s.writeText(0, 0, "한국어")
		expect(s.snapshot()[0]).toBe("한국어  ")
	})

	test("零宽字符不产生幽灵列", () => {
		const s = new Screen(10, 1)
		s.writeText(0, 0, "e\u0301x") // e + 组合尖音符 + x
		const cells = Array.from({ length: 10 }, (_, x) => s.cellAt(x, 0))
		// 网格中不得出现宽度为 0 且非宽字符占位的异常单元
		const anomalies = cells.filter((c) => c.width === 0 && c.ch !== "")
		expect(anomalies.length).toBe(0)
	})

	test("emoji 变更差分不撕裂", () => {
		const a = new Screen(10, 1)
		a.writeText(0, 0, "🚀ab")
		const b = new Screen(10, 1)
		b.writeText(0, 0, "✨ab")
		const delta = renderDelta(a, b)
		expect(delta).toContain("\x1b[1;1H")
		expect(delta).not.toContain("🚀")
		expect(renderFull(b)).toContain("✨")
	})

	test("长中文段落逐行写入无错位", () => {
		const s = new Screen(40, 3)
		const para = Array.from(
			"自研差分帧渲染器用于根治第三方渲染层的宽度口径分歧问题，同时作为原生层失效时的安全模式保底方案长期孵化演进",
		)
		const widthOf = (ch: string): number => (stringWidth(ch) === 2 ? 2 : 1)
		let row = 0
		let col = 0
		for (const ch of para) {
			if (row >= 3) break
			const w = widthOf(ch)
			if (col + w > s.width) {
				row += 1
				col = 0
				continue
			}
			s.writeText(col, row, ch)
			col += w
		}
		// 三行均从第 0 列起排，无残留错位
		expect(s.cellAt(0, 0).ch).not.toBe(" ")
		expect(s.cellAt(0, 1).ch).not.toBe(" ")
		expect(s.cellAt(0, 2).ch).not.toBe(" ")
	})
})
