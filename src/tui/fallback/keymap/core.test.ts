import { describe, expect, test } from "bun:test"
import { Keymap, stringifyKeyStroke } from "./core"
import type { Key } from "../input"

describe("stringifyKeyStroke", () => {
	test("文本/方向键/组合键/修饰键", () => {
		expect(stringifyKeyStroke({ type: "text", text: "a" })).toBe("a")
		expect(stringifyKeyStroke({ type: "up" })).toBe("up")
		expect(stringifyKeyStroke({ type: "ctrl-c" })).toBe("ctrl-c")
		expect(stringifyKeyStroke({ type: "ctrl", key: "t" })).toBe("ctrl+t")
		expect(stringifyKeyStroke({ type: "up", modifiers: { shift: true, alt: false, ctrl: true, meta: false } })).toBe(
			"ctrl+shift+up",
		)
	})

	test("粘贴/鼠标/焦点不进 keymap", () => {
		expect(stringifyKeyStroke({ type: "paste", text: "x" })).toBeUndefined()
		expect(stringifyKeyStroke({ type: "mouse", button: 0, x: 0, y: 0, motion: false, press: true })).toBeUndefined()
		expect(stringifyKeyStroke({ type: "focus", focused: true })).toBeUndefined()
	})
})

function keymapWith(bindings: Parameters<Keymap["bind"]>, commands: Record<string, (args?: unknown) => void>): Keymap {
	const keymap = new Keymap({ leaderTimeout: 0 })
	keymap.registerCommands(commands)
	keymap.bind(...bindings)
	return keymap
}

describe("Keymap：单键与序列", () => {
	test("单键绑定触发命令并消费按键", () => {
		let fired = false
		const keymap = keymapWith([{ keys: "ctrl+t", command: "test.fire" }], { "test.fire": () => (fired = true) })
		expect(keymap.handleKey({ type: "ctrl", key: "t" })).toBe(true)
		expect(fired).toBe(true)
	})

	test("序列：第一键进入等待，第二键触发", () => {
		let fired = false
		const keymap = keymapWith([{ keys: "g g", command: "test.fire" }], { "test.fire": () => (fired = true) })
		expect(keymap.handleKey({ type: "text", text: "g" })).toBe(true)
		expect(keymap.getPending()).toBe("g")
		expect(fired).toBe(false)
		expect(keymap.handleKey({ type: "text", text: "g" })).toBe(true)
		expect(fired).toBe(true)
		expect(keymap.getPending()).toBeUndefined()
	})

	test("不匹配序列时清空等待并放行", () => {
		let fired = false
		const keymap = keymapWith([{ keys: "g g", command: "test.fire" }], { "test.fire": () => (fired = true) })
		keymap.handleKey({ type: "text", text: "g" })
		expect(keymap.handleKey({ type: "text", text: "x" })).toBe(false)
		expect(keymap.getPending()).toBeUndefined()
		expect(keymap.handleKey({ type: "text", text: "g" })).toBe(true)
		expect(keymap.handleKey({ type: "text", text: "g" })).toBe(true)
		expect(fired).toBe(true)
	})

	test("绑定指向未注册命令时放行", () => {
		const keymap = keymapWith([{ keys: "ctrl+z", command: "missing" }], {})
		expect(keymap.handleKey({ type: "ctrl", key: "z" })).toBe(false)
	})

	test("escape 清空等待序列", () => {
		const keymap = keymapWith([{ keys: "g g", command: "noop" }], { noop: () => {} })
		keymap.handleKey({ type: "text", text: "g" })
		keymap.handleKey({ type: "escape" })
		expect(keymap.getPending()).toBeUndefined()
	})
})

describe("Keymap：leader 超时", () => {
	test("超时后序列等待自动清空", async () => {
		const keymap = new Keymap({ leaderTimeout: 20 })
		keymap.registerCommand("test.fire", () => {})
		keymap.bind({ keys: "g g", command: "test.fire" })
		keymap.handleKey({ type: "text", text: "g" })
		expect(keymap.getPending()).toBe("g")
		await new Promise((resolve) => setTimeout(resolve, 50))
		expect(keymap.getPending()).toBeUndefined()
	})
})

describe("Keymap：命令清单", () => {
	test("getCommands 返回注册清单（含 hidden）", () => {
		const keymap = new Keymap()
		keymap.registerCommand("a", () => {})
		keymap.registerCommand("b", () => {}, true)
		expect(keymap.getCommands().map((command) => `${command.name}:${command.hidden === true}`)).toEqual([
			"a:false",
			"b:true",
		])
	})
})
