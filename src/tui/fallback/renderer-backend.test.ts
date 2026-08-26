import { describe, expect, test } from "bun:test"
import { type RendererBackend } from "./renderer-backend"
import { FallbackRendererBackend, OpentuiRendererBackend, type CliRendererLike } from "./renderer-backend-adapters"
import { FallbackRenderer, MemoryBackend } from "./terminal"

/**
 * P2 立项前置：RendererBackend 抽象层契约验证。
 *
 * 目标：接口冻结成立——两个实现满足同一契约，可编译切换。
 * 验证：形状一致性、事件订阅/退订、destroy 语义、useMouse 转发。
 */

class FakeCliRenderer implements CliRendererLike {
	isDestroyed = false
	width = 80
	height = 24
	useMouse = false
	private listeners = new Map<string, Array<() => void>>()
	requestRenderCount = 0
	suspendCount = 0
	resumeCount = 0
	title = ""
	backgroundColor: unknown

	requestRender() {
		this.requestRenderCount += 1
	}
	on(event: string, listener: () => void) {
		const arr = this.listeners.get(event) ?? []
		arr.push(listener)
		this.listeners.set(event, arr)
		return this
	}
	off(event: string, listener: () => void) {
		const arr = this.listeners.get(event)
		if (arr) this.listeners.set(event, arr.filter((l) => l !== listener))
		return this
	}
	once(event: string, _listener: () => void) {
		// 简化：等价 on
		return this.on(event, _listener)
	}
	setTerminalTitle(title: string) {
		this.title = title
	}
	suspend() {
		this.suspendCount += 1
	}
	resume() {
		this.resumeCount += 1
	}
	setBackgroundColor(color: unknown) {
		this.backgroundColor = color
	}
	toggleDebugOverlay() {}

	emit(event: "destroy") {
		this.listeners.get(event)?.forEach((l) => l())
	}
}

describe("RendererBackend 抽象层契约（P2）", () => {
	test("opentui 适配：透传核心操作", () => {
		const fake = new FakeCliRenderer()
		const backend: RendererBackend = new OpentuiRendererBackend(fake)

		expect(backend.isDestroyed).toBe(false)
		backend.requestRender()
		backend.suspend()
		backend.resume()
		backend.setTerminalTitle("GycCode")
		backend.useMouse = true

		expect(fake.requestRenderCount).toBe(1)
		expect(fake.suspendCount).toBe(1)
		expect(fake.resumeCount).toBe(1)
		expect(fake.title).toBe("GycCode")
		expect(fake.useMouse).toBe(true)
		expect(backend.useMouse).toBe(true)
	})

	test("opentui 适配：destroy 事件透传", () => {
		const fake = new FakeCliRenderer()
		const backend: RendererBackend = new OpentuiRendererBackend(fake)
		const calls: string[] = []
		backend.once("destroy", () => calls.push("destroy"))
		fake.emit("destroy")
		expect(calls.join(",")).toBe("destroy")
	})

	test("fallback 适配：present 作为 requestRender、resize 转发", async () => {
		const mem = new MemoryBackend(80, 24)
		const renderer = new FallbackRenderer(mem)
		renderer.start()
		const backend: RendererBackend = new FallbackRendererBackend(renderer)

		const resized: string[] = []
		backend.on("resize", () => resized.push("resize"))
		mem.emitResize(100, 30)

		expect(backend.width).toBe(100)
		expect(backend.height).toBe(30)
		expect(resized.join(",")).toBe("resize")

		backend.setTerminalTitle("GycCode") // 空实现，不应抛
		backend.requestRender()
		await new Promise((r) => setTimeout(r, 0))
		expect(renderer.isDestroyed).toBe(false)
	})

	test("fallback 适配：destroy 解绑并通知", () => {
		const mem = new MemoryBackend(80, 24)
		const renderer = new FallbackRenderer(mem)
		const backend = new FallbackRendererBackend(renderer)

		const calls: string[] = []
		backend.once("destroy", () => calls.push("destroy"))
		backend.destroy()

		expect(backend.isDestroyed).toBe(true)
		expect(calls.join(",")).toBe("destroy")
		// destroy 后再次 destroy：事件不重复触发
		backend.destroy()
		expect(calls.length).toBe(1)
	})

	test("双实现同构：同一契约可互相替换", () => {
		const fake = new FakeCliRenderer()
		const opentui: RendererBackend = new OpentuiRendererBackend(fake)
		const mem = new MemoryBackend(80, 24)
		const renderer = new FallbackRenderer(mem)
		const fallback: RendererBackend = new FallbackRendererBackend(renderer)

		const common: Array<keyof RendererBackend> = [
			"requestRender",
			"setTerminalTitle",
			"suspend",
			"resume",
			"setBackgroundColor",
			"toggleDebugOverlay",
			"on",
			"once",
		]
		for (const key of common) {
			expect(typeof opentui[key]).toBe("function")
			expect(typeof fallback[key]).toBe("function")
		}
	})
})