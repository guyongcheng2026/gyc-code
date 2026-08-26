import { describe, expect, test } from "bun:test"
import { DemoApp } from "./demo-app"
import { MemoryBackend } from "./terminal"

describe("安全模式界面（集成）", () => {
	test("启动后绘制标题、消息与提示条", async () => {
		const backend = new MemoryBackend(80, 10)
		const app = new DemoApp({ backend, title: "测试标题", initialMessages: ["系统: 就绪"] })
		app.run()
		await new Promise((r) => setTimeout(r, 0))
		expect(backend.output).toContain("测试标题")
		expect(backend.output).toContain("就绪")
		expect(backend.output).toContain("安全模式")
		expect(app.isDone).toBe(false)
	})

	test("输入回车后消息回显", async () => {
		const backend = new MemoryBackend(40, 10)
		const app = new DemoApp({ backend, title: "t" })
		app.run()
		await new Promise((r) => setTimeout(r, 0))
		backend.emitInput("你好")
		await new Promise((r) => setTimeout(r, 0))
		backend.emitInput("\r")
		await new Promise((r) => setTimeout(r, 0))
		expect(backend.output).toContain("你: 你好")
	})

	test("Esc 退出并恢复终端序列", () => {
		const backend = new MemoryBackend(40, 10)
		const app = new DemoApp({ backend, title: "t" })
		app.run()
		backend.emitInput("\x1b")
		expect(app.isDone).toBe(true)
		expect(backend.output).toContain("\x1b[?1049l")
	})

	test("Ctrl+C 与方向键滚动不抛异常", async () => {
		const backend = new MemoryBackend(40, 10)
		const app = new DemoApp({
			backend,
			title: "t",
			initialMessages: Array.from({ length: 30 }, (_, i) => `m${i}`),
		})
		app.run()
		await new Promise((r) => setTimeout(r, 0))
		backend.emitInput("\x1b[A\x1b[5~\x1b[B\x1b[6~\x03")
		expect(app.isDone).toBe(true)
	})
})
