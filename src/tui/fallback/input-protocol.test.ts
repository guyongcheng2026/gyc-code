import { describe, expect, test } from "bun:test"
import { KeyParser, parseModifiers, type Key } from "./input"

function parse(chunks: string[]): Key[] {
	const keys: Key[] = []
	const parser = new KeyParser((key) => keys.push(key))
	for (const chunk of chunks) parser.feed(chunk)
	return keys
}

describe("bracketed paste", () => {
	test("单 chunk 交付整段文本，内部换行不触发 Enter", () => {
		const keys = parse(["\x1b[200~a\nb\x1b[201~"])
		expect(keys).toEqual([{ type: "paste", text: "a\nb" }])
	})

	test("跨 chunk 拼接后交付", () => {
		const keys = parse(["\x1b[200~hel", "lo\nwor", "ld\x1b[201~"])
		expect(keys).toEqual([{ type: "paste", text: "hello\nworld" }])
	})

	test("CRLF 原样保留（由消费方归一化）", () => {
		const keys = parse(["\x1b[200~a\r\nb\x1b[201~"])
		expect(keys[0]).toEqual({ type: "paste", text: "a\r\nb" })
	})

	test("粘贴后的普通按键仍正常解析", () => {
		const keys = parse(["\x1b[200~x\x1b[201~\r"])
		expect(keys).toEqual([{ type: "paste", text: "x" }, { type: "enter" }])
	})
})

describe("焦点事件", () => {
	test("CSI I/O 映射为 focus true/false", () => {
		expect(parse(["\x1b[I"])).toEqual([{ type: "focus", focused: true }])
		expect(parse(["\x1b[O"])).toEqual([{ type: "focus", focused: false }])
	})
})

describe("修饰键矩阵", () => {
	test("mod 数值解析（1=无修饰，2=shift，3=alt，4=shift+alt，5=ctrl）", () => {
		expect(parseModifiers(1)).toEqual({ shift: false, alt: false, ctrl: false, meta: false })
		expect(parseModifiers(2)).toEqual({ shift: true, alt: false, ctrl: false, meta: false })
		expect(parseModifiers(3)).toEqual({ shift: false, alt: true, ctrl: false, meta: false })
		expect(parseModifiers(4)).toEqual({ shift: true, alt: true, ctrl: false, meta: false })
		expect(parseModifiers(5)).toEqual({ shift: false, alt: false, ctrl: true, meta: false })
	})

	test("CSI 1;5A → Ctrl+Up", () => {
		const keys = parse(["\x1b[1;5A"])
		expect(keys[0]?.type).toBe("up")
		expect(keys[0]?.modifiers?.ctrl).toBe(true)
	})

	test("CSI 1;2B → Shift+Down", () => {
		const keys = parse(["\x1b[1;2B"])
		expect(keys[0]?.type).toBe("down")
		expect(keys[0]?.modifiers?.shift).toBe(true)
	})

	test("tilde 带修饰：5;5~ → Ctrl+PageUp", () => {
		const keys = parse(["\x1b[5;5~"])
		expect(keys[0]?.type).toBe("pageup")
		expect(keys[0]?.modifiers?.ctrl).toBe(true)
	})

	test("kitty CSI u：97;5u → Ctrl+a 文本", () => {
		const keys = parse(["\x1b[97;5u"])
		expect(keys[0]?.type).toBe("text")
		expect((keys[0] as { text: string }).text).toBe("a")
		expect(keys[0]?.modifiers?.ctrl).toBe(true)
	})

	test("无修饰的经典编码不附加 modifiers", () => {
		const keys = parse(["\x1b[A"])
		expect(keys[0]).toEqual({ type: "up" })
	})
})
