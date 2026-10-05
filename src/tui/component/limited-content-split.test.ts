import { describe, expect, test } from "bun:test"
import { splitPlainRows } from "./limited-content"

/**
 * 极端超长内容降级到 plain 分支后，若仍按整段渲染单个 <text>，
 * 单个节点的行数依然可能撞满 opentui 的句柄预算（单 <text> 约 3 个句柄）。
 * 因此 plain 分支必须按行切分成多个节点，且切分后的总行数不得超过折叠上限。
 */

describe("splitPlainRows（plain 分支按行切分）", () => {
	test("单行内容原样返回单段，不做任何拆分", () => {
		expect(splitPlainRows("只有一行")).toEqual(["只有一行"])
	})

	test("空串返回一个空段，避免渲染出零个节点", () => {
		expect(splitPlainRows("")).toEqual([""])
	})

	test("多行按换行拆成多段，且内容可无损拼回", () => {
		const text = "第一行\n第二行\n第三行"
		const rows = splitPlainRows(text)
		expect(rows).toHaveLength(3)
		expect(rows).toEqual(["第一行\n", "第二行\n", "第三行"])
		expect(rows.join("")).toBe(text)
	})

	test("保留尾部空行，不丢内容", () => {
		expect(splitPlainRows("a\nb\n")).toEqual(["a\n", "b\n", ""])
		expect(splitPlainRows("a\n\nb")).toEqual(["a\n", "\n", "b"])
	})

	test("CRLF 与 CR 也按行边界拆分，且拼接后保留原换行符", () => {
		expect(splitPlainRows("a\r\nb")).toEqual(["a\r\n", "b"])
		expect(splitPlainRows("a\rb")).toEqual(["a\r", "b"])
		expect(splitPlainRows("a\r\nb").join("")).toBe("a\r\nb")
	})

	test("超长内容切分后总行数被上限截断", () => {
		const text = Array.from({ length: 50_000 }, (_, index) => `行${index}`).join("\n")
		const rows = splitPlainRows(text, 2_000)
		expect(rows).toHaveLength(2_000)
	})

	test("切分上限非法时夹到默认值，不抛异常", () => {
		const text = Array.from({ length: 300 }, (_, index) => `行${index}`).join("\n")
		for (const max of [0, -1, Number.NaN]) {
			const rows = splitPlainRows(text, max)
			expect(rows.length).toBe(300)
		}
	})

	test("行数远低于上限时不做无谓截断", () => {
		const text = Array.from({ length: 10 }, (_, index) => `行${index}`).join("\n")
		expect(splitPlainRows(text, 2_000)).toHaveLength(10)
	})

	test("确定性：同样输入两次调用结果完全一致", () => {
		const text = "甲\n乙\n丙"
		expect(splitPlainRows(text)).toEqual(splitPlainRows(text))
	})
})