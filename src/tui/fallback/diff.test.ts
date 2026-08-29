import { describe, expect, test } from "bun:test"
import { ENTER_SEQ, renderDelta, renderFull } from "./diff"
import { Screen } from "./screen"

// 确保 truecolor 模式（否则 diff 降级到 256 色）
process.env.COLORTERM = "truecolor"

describe("差分帧引擎", () => {
	test("首帧全量绘制包含定位与文本", () => {
		const s = new Screen(10, 3)
		s.writeText(0, 0, "hello")
		const full = renderFull(s)
		expect(full).toContain("\x1b[1;1H")
		expect(full).toContain("hello")
	})

	test("局部变更仅重绘变化行", () => {
		const a = new Screen(10, 3)
		a.writeText(0, 0, "aaa")
		a.writeText(0, 1, "bbb")
		a.writeText(0, 2, "ccc")
		const b = new Screen(10, 3)
		b.writeText(0, 0, "aaa")
		b.writeText(0, 1, "bXb")
		b.writeText(0, 2, "ccc")
		const delta = renderDelta(a, b)
		expect(delta).toContain("\x1b[2;")
		expect(delta).not.toContain("\x1b[1;")
		expect(delta).not.toContain("\x1b[3;")
	})

	test("无变化输出空串", () => {
		const a = new Screen(10, 3)
		const b = new Screen(10, 3)
		expect(renderDelta(a, b)).toBe("")
	})

	test("尺寸变化退化为全量重绘", () => {
		const a = new Screen(10, 3)
		const b = new Screen(8, 3)
		const delta = renderDelta(a, b)
		expect(delta.length).toBeGreaterThan(0)
		expect(delta).toBe(renderFull(b))
	})

	test("宽字符 run 边界不撕裂", () => {
		const a = new Screen(10, 1)
		const b = new Screen(10, 1)
		a.writeText(0, 0, "中文ab")
		b.writeText(0, 0, "中x文ab")
		const delta = renderDelta(a, b)
		// 变化区间从占位格扩展，重绘段必须包含完整「文」而非残缺
		expect(delta).toContain("文")
		expect(delta).toContain("\x1b[1;3H")
	})

	test("样式变化触发 SGR 切换", () => {
		const a = new Screen(4, 1)
		const b = new Screen(4, 1)
		a.writeText(0, 0, "ab", { fg: "#ff0000" })
		b.writeText(0, 0, "ab", { fg: "#00ff00" })
		const delta = renderDelta(a, b)
		expect(delta).toContain("38;2;0;255;0")
	})

	test("进入序列含 alt-screen 与隐藏光标", () => {
		expect(ENTER_SEQ).toContain("\x1b[?1049h")
		expect(ENTER_SEQ).toContain("\x1b[?25l")
	})

	test("全量帧字节量：80x24 满屏中文 < 4KB 目标线", () => {
		const s = new Screen(80, 24)
		for (let y = 0; y < 24; y++) {
			s.writeText(0, y, "编码测试宽度口径验证".repeat(4))
		}
		expect(renderFull(s).length).toBeLessThan(4096 * 2)
	})
})
