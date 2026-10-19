import { describe, expect, test } from "bun:test"
import { EditBuffer } from "./edit-buffer"

describe("编辑缓冲：基础编辑", () => {
	test("插入文本并推进光标", () => {
		const buffer = new EditBuffer()
		buffer.insert("abc")
		expect(buffer.text).toBe("abc")
		expect(buffer.cursor).toEqual({ row: 0, col: 3 })
	})

	test("多行插入（粘贴）保持换行与光标位置", () => {
		const buffer = new EditBuffer()
		buffer.insert("a\nb\nc")
		expect(buffer.text).toBe("a\nb\nc")
		expect(buffer.cursor).toEqual({ row: 2, col: 1 })
	})

	test("CRLF 归一化为 LF", () => {
		const buffer = new EditBuffer()
		buffer.insert("a\r\nb")
		expect(buffer.text).toBe("a\nb")
	})

	test("行首 backspace 合并上一行", () => {
		const buffer = new EditBuffer("ab\ncd")
		buffer.setCursor(1, 0)
		buffer.backspace()
		expect(buffer.text).toBe("abcd")
		expect(buffer.cursor).toEqual({ row: 0, col: 2 })
	})

	test("行尾 deleteForward 合并下一行", () => {
		const buffer = new EditBuffer("ab\ncd")
		buffer.setCursor(0, 2)
		buffer.deleteForward()
		expect(buffer.text).toBe("abcd")
	})

	test("上下移动时列号按行长夹紧", () => {
		const buffer = new EditBuffer("abcdef\nxy")
		buffer.setCursor(0, 5)
		buffer.moveDown()
		expect(buffer.cursor).toEqual({ row: 1, col: 2 })
	})

	test("代理对按 code point 计列", () => {
		const buffer = new EditBuffer()
		buffer.insert("🙂a")
		expect(buffer.cursor.col).toBe(2)
		buffer.backspace()
		expect(buffer.text).toBe("🙂")
		buffer.backspace()
		expect(buffer.text).toBe("")
	})
})

describe("编辑缓冲：kill 操作", () => {
	test("Ctrl+W 删除光标前一个词", () => {
		const buffer = new EditBuffer("foo bar")
		buffer.setCursor(0, 7)
		buffer.deleteWordBefore()
		expect(buffer.text).toBe("foo ")
		expect(buffer.cursor.col).toBe(4)
	})

	test("Ctrl+K 删到行尾", () => {
		const buffer = new EditBuffer("hello world")
		buffer.setCursor(0, 5)
		expect(buffer.killToLineEnd()).toBe(" world")
		expect(buffer.text).toBe("hello")
	})

	test("Ctrl+K 在行尾时合并下一行", () => {
		const buffer = new EditBuffer("ab\ncd")
		buffer.setCursor(0, 2)
		buffer.killToLineEnd()
		expect(buffer.text).toBe("abcd")
	})

	test("Ctrl+U 删到行首", () => {
		const buffer = new EditBuffer("hello")
		buffer.setCursor(0, 3)
		expect(buffer.killToLineStart()).toBe("hel")
		expect(buffer.text).toBe("lo")
		expect(buffer.cursor.col).toBe(0)
	})
})

describe("编辑缓冲：撤销与重做", () => {
	test("undo 回退一步，redo 恢复", () => {
		const buffer = new EditBuffer()
		buffer.insert("a")
		buffer.insert("b")
		expect(buffer.text).toBe("ab")
		expect(buffer.undo()).toBe(true)
		expect(buffer.text).toBe("a")
		expect(buffer.redo()).toBe(true)
		expect(buffer.text).toBe("ab")
	})

	test("新编辑清空 redo 栈", () => {
		const buffer = new EditBuffer()
		buffer.insert("a")
		buffer.undo()
		expect(buffer.canRedo).toBe(true)
		buffer.insert("b")
		expect(buffer.canRedo).toBe(false)
	})

	test("撤销栈上限 100 步", () => {
		const buffer = new EditBuffer()
		for (let i = 0; i < 150; i++) buffer.insert("x")
		let count = 0
		while (buffer.undo()) count += 1
		expect(count).toBe(100)
	})
})

describe("编辑缓冲：选择", () => {
	test("选中文本并删除", () => {
		const buffer = new EditBuffer("hello world")
		buffer.setCursor(0, 0)
		buffer.beginSelection()
		buffer.setCursor(0, 5)
		expect(buffer.hasSelection).toBe(true)
		expect(buffer.getSelectedText()).toBe("hello")
		expect(buffer.deleteSelection()).toBe(true)
		expect(buffer.text).toBe(" world")
		expect(buffer.cursor).toEqual({ row: 0, col: 0 })
	})

	test("反向选择（锚点在后）文本顺序仍正确", () => {
		const buffer = new EditBuffer("abcdef")
		buffer.setCursor(0, 4)
		buffer.beginSelection()
		buffer.setCursor(0, 1)
		expect(buffer.getSelectedText()).toBe("bcd")
	})

	test("跨行选择", () => {
		const buffer = new EditBuffer("ab\ncd\nef")
		buffer.setCursor(0, 1)
		buffer.beginSelection()
		buffer.setCursor(2, 1)
		expect(buffer.getSelectedText()).toBe("b\ncd\ne")
	})
})

describe("编辑缓冲：extmarks", () => {
	test("注册类型幂等", () => {
		const buffer = new EditBuffer()
		expect(buffer.registerType("prompt-part")).toBe(buffer.registerType("prompt-part"))
	})

	test("插入点之后的标记整体平移", () => {
		const buffer = new EditBuffer("abcdef")
		const mark = buffer.setMark("prompt-part", 3, 5)
		buffer.setCursor(0, 1)
		buffer.insert("XY")
		expect([mark.start, mark.end]).toEqual([5, 7])
	})

	test("跨插入点的标记延长", () => {
		const buffer = new EditBuffer("abcdef")
		const mark = buffer.setMark("prompt-part", 2, 4)
		buffer.setCursor(0, 3)
		buffer.insert("Z")
		expect([mark.start, mark.end]).toEqual([2, 5])
	})

	test("删除使标记收缩且不越过起点", () => {
		const buffer = new EditBuffer("abcdef")
		const mark = buffer.setMark("prompt-part", 2, 4)
		buffer.setCursor(0, 2)
		buffer.deleteForward()
		expect(mark.start).toBe(2)
		expect(mark.end).toBe(3)
	})

	test("按类型筛选与清空", () => {
		const buffer = new EditBuffer()
		buffer.setMark("a", 0, 1)
		buffer.setMark("b", 0, 1)
		expect(buffer.marksOf("a").length).toBe(1)
		buffer.clearMarks("a")
		expect(buffer.marksOf("a").length).toBe(0)
		expect(buffer.marksOf().length).toBe(1)
	})

	test("R1：起点落在删除区间内、终点在其后时 end 按剩余长度重算", () => {
		const buffer = new EditBuffer("abcdef")
		const mark = buffer.setMark("prompt-part", 2, 6)
		// 删除 [1,4)：标记剩余部分 [4,6) 平移到 [1,3)
		buffer.setCursor(0, 1)
		buffer.deleteForward()
		buffer.deleteForward()
		buffer.deleteForward()
		expect(buffer.text).toBe("aef")
		expect([mark.start, mark.end]).toEqual([1, 3])
	})

	test("R1：标记被删除区间完全吞没时收敛为空标记", () => {
		const buffer = new EditBuffer("abcdef")
		const mark = buffer.setMark("prompt-part", 2, 4)
		buffer.setCursor(0, 1)
		for (let i = 0; i < 3; i++) buffer.deleteForward()
		expect(buffer.text).toBe("aef")
		expect([mark.start, mark.end]).toEqual([1, 1])
	})

	test("R5：undo 恢复标记到编辑前位置", () => {
		const buffer = new EditBuffer("abcdef")
		const mark = buffer.setMark("prompt-part", 2, 4)
		buffer.setCursor(0, 1)
		buffer.insert("XY")
		expect([mark.start, mark.end]).toEqual([4, 6])
		buffer.undo()
		expect([mark.start, mark.end]).toEqual([2, 4])
	})
})
