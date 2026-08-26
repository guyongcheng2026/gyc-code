import { describe, expect, test } from "bun:test"
import { Screen } from "./screen"

describe("Screen Cell 网格", () => {
	test("半角文本写入与快照", () => {
		const s = new Screen(10, 3)
		s.writeText(0, 0, "hello")
		expect(s.snapshot()[0]).toBe("hello     ")
	})

	test("中文占 2 列且占位格不重复输出字符", () => {
		const s = new Screen(10, 1)
		s.writeText(0, 0, "中文")
		expect(s.snapshot()[0]).toBe("中文      ")
		const main = s.cellAt(0, 0)
		expect(main.width).toBe(2)
		const pad = s.cellAt(1, 0)
		expect(pad.width).toBe(0)
		expect(pad.ch).toBe("")
	})

	test("行尾放不下宽字符时停止写入", () => {
		const s = new Screen(5, 1)
		const end = s.writeText(4, 0, "中")
		expect(end).toBe(4)
		expect(s.cellAt(4, 0).ch).toBe(" ")
	})

	test("宽字符恰好占据行尾两列可写入", () => {
		const s = new Screen(6, 1)
		const end = s.writeText(4, 0, "中")
		expect(end).toBe(6)
		expect(s.cellAt(4, 0).ch).toBe("中")
		expect(s.cellAt(5, 0).width).toBe(0)
	})

	test("控制字符替换为空格", () => {
		const s = new Screen(10, 1)
		s.writeText(0, 0, "a\tb")
		expect(s.snapshot()[0]?.startsWith("a b")).toBe(true)
	})

	test("resize 保留左上重叠区域并返回变化标志", () => {
		const s = new Screen(10, 3)
		s.writeText(0, 0, "abc")
		expect(s.resize(8, 2)).toBe(true)
		expect(s.width).toBe(8)
		expect(s.height).toBe(2)
		expect(s.snapshot()[0]).toBe("abc     ")
		expect(s.resize(8, 2)).toBe(false)
	})

	test("clear 重置全部网格", () => {
		const s = new Screen(4, 2)
		s.writeText(0, 0, "test")
		s.clear()
		expect(s.snapshot()[0]).toBe("    ")
	})

	test("fillRect 应用样式", () => {
		const s = new Screen(4, 2)
		s.fillRect(0, 0, 4, 1, { fg: "#ff0000", reverse: true })
		expect(s.cellAt(0, 0).style.reverse).toBe(true)
		expect(s.cellAt(0, 1).style.reverse).toBeUndefined()
	})

	test("越界写坐标安全无异常", () => {
		const s = new Screen(4, 2)
		expect(() => {
			s.writeText(-3, -1, "x")
			s.writeText(99, 99, "x")
			s.fillRect(-1, -1, 9, 9, {})
		}).not.toThrow()
	})
})
