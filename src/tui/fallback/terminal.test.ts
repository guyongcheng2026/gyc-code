import { describe, expect, test } from "bun:test"
import { FallbackRenderer, MemoryBackend } from "./terminal"

function drain(): Promise<void> {
	return new Promise((resolve) => setTimeout(resolve, 0))
}

describe("终端抽象与帧调度", () => {
	test("start 进入 alt-screen 并全量绘制", async () => {
		const backend = new MemoryBackend(20, 5)
		const renderer = new FallbackRenderer(backend)
		renderer.start()
		renderer.present((s) => {
			s.writeText(0, 0, "标题")
		})
		await drain()
		expect(backend.output).toContain("\x1b[?1049h")
		expect(backend.output).toContain("标题")
		renderer.stop()
	})

	test("stop 恢复主屏与光标并关闭 raw mode", () => {
		const backend = new MemoryBackend(20, 5)
		const renderer = new FallbackRenderer(backend)
		renderer.start()
		renderer.stop()
		expect(backend.output).toContain("\x1b[?1049l")
		expect(backend.output).toContain("\x1b[?25h")
		expect(backend.rawMode).toBe(false)
	})

	test("同 tick 多次 present 合并为一次输出", async () => {
		const backend = new MemoryBackend(20, 5)
		const renderer = new FallbackRenderer(backend)
		renderer.start()
		const afterStart = backend.output.length
		renderer.present((s) => s.writeText(0, 1, "a"))
		renderer.present((s) => s.writeText(0, 2, "b"))
		renderer.present((s) => s.writeText(0, 3, "c"))
		await drain()
		const deltaOutput = backend.output.slice(afterStart)
		// 三行变更合并为一次微任务刷新：包含三行定位，但不产生三次独立全量
		expect(deltaOutput).toContain("\x1b[2;")
		expect(deltaOutput).toContain("\x1b[3;")
		expect(deltaOutput).toContain("\x1b[4;")
		renderer.stop()
	})

	test("resize 触发全量重绘", async () => {
		const backend = new MemoryBackend(20, 5)
		const renderer = new FallbackRenderer(backend)
		renderer.start()
		renderer.present((s) => s.writeText(0, 0, "内容"))
		await drain()
		const before = backend.output.length
		backend.emitResize(30, 8)
		const redraw = backend.output.slice(before)
		expect(redraw).toContain("内容")
		expect(renderer.currentScreen.width).toBe(30)
		renderer.stop()
	})
})
