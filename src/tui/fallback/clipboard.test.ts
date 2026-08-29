import { describe, expect, test } from "bun:test"
import { copyToClipboardViaOsc52 } from "./clipboard"

describe("剪贴板 OSC 52 写入", () => {
	test("空文本不发送任何字节", () => {
		copyToClipboardViaOsc52("")
		// 进程 stdout 无新增输出（无断言；仅确保不抛异常）
	})

	test("短文本编码后写入", () => {
		// 模拟 stdout 收集
		const captured: string[] = []
		const orig = process.stdout.write.bind(process.stdout)
		process.stdout.write = ((chunk: string | Uint8Array) => {
			captured.push(typeof chunk === "string" ? chunk : new TextDecoder().decode(chunk))
			return true
		}) as typeof process.stdout.write
		try {
			copyToClipboardViaOsc52("hello")
		} finally {
			process.stdout.write = orig
		}
		expect(captured.length).toBe(1)
		const out = captured[0]!
		expect(out).toStartWith("\x1b]52;c;")
		expect(out).toEndWith("\x07")
		// "hello" 的 base64 是 "aGVsbG8="
		expect(out).toContain("aGVsbG8=")
	})

	test("中文文本编码（UTF-8 → base64）", () => {
		const captured: string[] = []
		const orig = process.stdout.write.bind(process.stdout)
		process.stdout.write = ((chunk: string | Uint8Array) => {
			captured.push(typeof chunk === "string" ? chunk : new TextDecoder().decode(chunk))
			return true
		}) as typeof process.stdout.write
		try {
			copyToClipboardViaOsc52("你好")
		} finally {
			process.stdout.write = orig
		}
		expect(captured.length).toBe(1)
		// "你好" 的 UTF-8 字节是 0xE4 0xBD 0xA0 0xE5 0xA5 0xBD
		// base64 = "5L2g5aW9"
		expect(captured[0]).toContain("5L2g5aW9")
	})

	test("超长文本分块（> 4096 字节）", () => {
		const captured: string[] = []
		const orig = process.stdout.write.bind(process.stdout)
		process.stdout.write = ((chunk: string | Uint8Array) => {
			captured.push(typeof chunk === "string" ? chunk : new TextDecoder().decode(chunk))
			return true
		}) as typeof process.stdout.write
		try {
			const long = "x".repeat(8000)
			copyToClipboardViaOsc52(long)
		} finally {
			process.stdout.write = orig
		}
		// 8000 字符的 base64 ≈ 10668 字节，分 3 块
		expect(captured.length).toBe(3)
		for (const chunk of captured) {
			expect(chunk).toStartWith("\x1b]52;c;")
			expect(chunk).toEndWith("\x07")
		}
	})
})
