import { describe, expect, test } from "bun:test"
import { MemoryBackend } from "./terminal"
import { runFallbackSafeMode, shouldUseFallback } from "./safe-mode"

describe("安全模式降级通道", () => {
	test("开关判定：未设置/auto/fallback 均启用，opentui 禁用", () => {
		const saved = process.env.GYC_TUI_BACKEND
		try {
			delete process.env.GYC_TUI_BACKEND
			expect(shouldUseFallback()).toBe(true)
			process.env.GYC_TUI_BACKEND = "auto"
			expect(shouldUseFallback()).toBe(true)
			process.env.GYC_TUI_BACKEND = "fallback"
			expect(shouldUseFallback()).toBe(true)
			process.env.GYC_TUI_BACKEND = "opentui"
			expect(shouldUseFallback()).toBe(false)
		} finally {
			if (saved === undefined) delete process.env.GYC_TUI_BACKEND
			else process.env.GYC_TUI_BACKEND = saved
		}
	})

	test("展示错误摘要与恢复指引，退出后返回 true", async () => {
		const backend = new MemoryBackend(80, 10)
		const app = runFallbackSafeMode({
			backend,
			error: new Error("模拟 FFI 加载失败"),
			productLabel: "gyc-code 0.0.1",
		})
		await new Promise((r) => setTimeout(r, 0))
		expect(backend.output).toContain("安全模式")
		expect(backend.output).toContain("FFI")
		expect(backend.output).toContain("GYC_TUI_BACKEND")
		backend.emitInput("\x1b")
		expect(await app).toBe(true)
	})

	test("非 Error 对象也能安全格式化", async () => {
		const backend = new MemoryBackend(80, 10)
		const app = runFallbackSafeMode({ backend, error: "纯字符串错误" })
		await new Promise((r) => setTimeout(r, 0))
		expect(backend.output).toContain("纯字符串错误")
		backend.emitInput("\x03")
		expect(await app).toBe(true)
	})
})
