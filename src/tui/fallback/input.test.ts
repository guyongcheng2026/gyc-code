import { describe, expect, test } from "bun:test"
import { KeyParser, setSgrMouse, disableMouse, type Key } from "./input"

function parse(chunks: string[]): Key[] {
	const keys: Key[] = []
	const parser = new KeyParser((key) => keys.push(key))
	for (const chunk of chunks) parser.feed(chunk)
	return keys
}

describe("按键解析", () => {
	test("方向键", () => {
		expect(parse(["\x1b[A\x1b[B\x1b[C\x1b[D"]).map((k) => k.type)).toEqual([
			"up",
			"down",
			"right",
			"left",
		])
	})

	test("翻页与首尾键（tilde 序列）", () => {
		expect(parse(["\x1b[5~\x1b[6~\x1b[H\x1b[F"]).map((k) => k.type)).toEqual([
			"pageup",
			"pagedown",
			"home",
			"end",
		])
	})

	test("回车、退格、Ctrl+C、独立 ESC", () => {
		expect(parse(["\r"]).map((k) => k.type)).toEqual(["enter"])
		expect(parse(["\x7f"]).map((k) => k.type)).toEqual(["backspace"])
		expect(parse(["\x03"]).map((k) => k.type)).toEqual(["ctrl-c"])
		expect(parse(["\x1b"]).map((k) => k.type)).toEqual(["escape"])
	})

	test("普通文本与中文粘贴整段交付", () => {
		const keys = parse(["你好 world"])
		const text = keys
			.filter((k): k is Extract<Key, { type: "text" }> => k.type === "text")
			.map((k) => k.text)
			.join("")
		expect(text).toBe("你好 world")
	})

	test("跨 chunk 截断的 CSI 前缀等待拼齐", () => {
		expect(parse(["\x1b[", "A"]).map((k) => k.type)).toEqual(["up"])
	})

	test("混合序列与文本交互解析", () => {
		const keys = parse(["ab\x1b[Acd"])
		expect(keys.some((k) => k.type === "up")).toBe(true)
		const text = keys
			.filter((k): k is Extract<Key, { type: "text" }> => k.type === "text")
			.map((k) => k.text)
			.join("")
		expect(text).toBe("abcd")
	})

	test("DSR 响应解析", () => {
		const keys = parse(["\x1b[10;20R"])
		expect(keys).toEqual([{ type: "cursor-request", row: 10, col: 20 }])
	})

	test("SGR 左键按下", () => {
		const keys = parse(["\x1b[<0;15;8M"])
		expect(keys).toEqual([{ type: "mouse", button: 0, x: 15, y: 8, motion: false, press: true }])
	})

	test("SGR 右键释放", () => {
		const keys = parse(["\x1b[<2;5;12m"])
		expect(keys).toEqual([{ type: "mouse", button: 2, x: 5, y: 12, motion: false, press: false }])
	})

	test("SGR 滚轮上滚", () => {
		const keys = parse(["\x1b[<64;20;10M"])
		expect(keys).toEqual([{ type: "mouse", button: 64, x: 20, y: 10, motion: false, press: true }])
	})

	test("SGR 滚轮下滚", () => {
		const keys = parse(["\x1b[<65;20;10M"])
		expect(keys).toEqual([{ type: "mouse", button: 65, x: 20, y: 10, motion: false, press: true }])
	})

	test("SGR 移动事件", () => {
		const keys = parse(["\x1b[<35;10;5M"])
		expect(keys).toEqual([{ type: "mouse", button: 3, x: 10, y: 5, motion: true, press: true }])
	})

	test("SGR 跨 chunk 解析", () => {
		const keys = parse(["\x1b[<0;", "15;8M"])
		expect(keys).toEqual([{ type: "mouse", button: 0, x: 15, y: 8, motion: false, press: true }])
	})

	test("setSgrMouse 输出正确序列", () => {
		const captured: string[] = []
		setSgrMouse((d) => captured.push(d))
		expect(captured[0]).toBe("\x1b[?1006h\x1b[?1002h\x1b[?1005h")
	})

	test("disableMouse 输出正确序列", () => {
		const captured: string[] = []
		disableMouse((d) => captured.push(d))
		expect(captured[0]).toBe("\x1b[?1006l\x1b[?1002l\x1b[?1005l")
	})
})
