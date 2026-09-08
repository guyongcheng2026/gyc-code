// gyc-code TUI fallback演示测试——安全模式界面集成测试
import { describe, expect, test } from "bun:test"
import { DemoApp } from "./demo-app"
import { MemoryBackend } from "./terminal"

// 去除ANSI转义序列：\x1b[...m 等，包括 \x1b[?...h/l 等
const stripAnsi = (s: string) => s.replace(/\x1b\[[0-9;?]*[a-zA-Z]/g, "")

// describe("安全模式界面（集成）", () => {
	test("启动后绘制标题、消息与提示条", async () => {
		const backend = new MemoryBackend(80, 10)
		const app = new DemoApp({ backend, title: "测试标题", initialMessages: ["系统: 就绪"] })
		app.run()
		await new Promise((r) => setTimeout(r, 10)) // 给渲染循环一点时间
		expect(stripAnsi(backend.output)).toContain("测试标题")
		expect(stripAnsi(backend.output)).toContain("就绪")
		expect(stripAnsi(backend.output)).toContain("安全模式")
		expect(app.isDone).toBe(false)
	})

	test("输入回车后消息回显", async () => {
		const backend = new MemoryBackend(40, 10)
		const app = new DemoApp({ backend, title: "t" })
		app.run()
		await new Promise((r) => setTimeout(r, 10))
		backend.emitInput("你好")
		// 渲染器按 60fps 节流（约 16.7ms 最小帧间隔），需等待超过该间隔才能确保帧已刷出
		await new Promise((r) => setTimeout(r, 40))
		backend.emitInput("\r")
		await new Promise((r) => setTimeout(r, 40))
		expect(stripAnsi(backend.output)).toContain("你: 你好")
	})

	test("Esc 退出并恢复终端序列", async () => {
		const backend = new MemoryBackend(40, 10)
		const app = new DemoApp({ backend, title: "t" })
		app.run()
		await new Promise((r) => setTimeout(r, 10))
		backend.emitInput("\x1b")
		expect(app.isDone).toBe(true)
		// 恢复终端序列是转义序列本身，stripAnsi 会把它剥掉，必须断言原始输出流
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
		await new Promise((r) => setTimeout(r, 10))
		backend.emitInput("\x1b[A\x1b[5~\x1b[B\x1b[6~\x03")
		await new Promise((r) => setTimeout(r, 10))
		expect(app.isDone).toBe(true)
	})