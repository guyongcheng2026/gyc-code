import { describe, expect, test } from "bun:test"
import { KeyParser, type Key } from "./input"

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

	test("混合序列与文本交错解析", () => {
		const keys = parse(["ab\x1b[Acd"])
		expect(keys.some((k) => k.type === "up")).toBe(true)
		const text = keys
			.filter((k): k is Extract<Key, { type: "text" }> => k.type === "text")
			.map((k) => k.text)
			.join("")
		expect(text).toBe("abcd")
	})

	test("病态超长未识别序列被安全丢弃不撑爆缓冲", () => {
		const keys = parse([`\x1b[${"9".repeat(64)}~`])
		expect(keys.every((k) => k.type !== "text" || !k.text.includes("\x1b"))).toBe(true)
	})
})
