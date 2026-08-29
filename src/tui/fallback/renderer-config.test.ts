import { describe, expect, test } from "bun:test"
import { backendChoice, isExplicitFallback, shouldUseFallback } from "./safe-mode"

describe("P2 渲染器配置开关", () => {
	test("env 优先级最高：env=fallback 时 configRenderer=opentui 仍走 fallback", () => {
		const saved = process.env.GYC_TUI_BACKEND
		try {
			process.env.GYC_TUI_BACKEND = "fallback"
			expect(backendChoice("opentui")).toBe("fallback")
			expect(backendChoice("auto")).toBe("fallback")
		} finally {
			if (saved === undefined) delete process.env.GYC_TUI_BACKEND
			else process.env.GYC_TUI_BACKEND = saved
		}
	})

	test("env=opentui 优先级最高", () => {
		const saved = process.env.GYC_TUI_BACKEND
		try {
			process.env.GYC_TUI_BACKEND = "opentui"
			expect(backendChoice("fallback")).toBe("opentui")
			expect(backendChoice("auto")).toBe("opentui")
		} finally {
			if (saved === undefined) delete process.env.GYC_TUI_BACKEND
			else process.env.GYC_TUI_BACKEND = saved
		}
	})

	test("env 未设时 configRenderer 生效（P3-3: default = fallback）", () => {
		const saved = process.env.GYC_TUI_BACKEND
		try {
			delete process.env.GYC_TUI_BACKEND
			expect(backendChoice(undefined)).toBe("fallback")
			expect(backendChoice("fallback")).toBe("fallback")
			expect(backendChoice("opentui")).toBe("opentui")
			expect(backendChoice("auto")).toBe("fallback")
		} finally {
			if (saved === undefined) delete process.env.GYC_TUI_BACKEND
			else process.env.GYC_TUI_BACKEND = saved
		}
	})

	test("isExplicitFallback(configRenderer)：P3-3 default fallback 判定为 true", () => {
		const saved = process.env.GYC_TUI_BACKEND
		try {
			delete process.env.GYC_TUI_BACKEND
			expect(isExplicitFallback(undefined)).toBe(true) // P3-3: default = fallback
			expect(isExplicitFallback("auto")).toBe(true) // P3-3: auto → fallback
			expect(isExplicitFallback("opentui")).toBe(false)
			expect(isExplicitFallback("fallback")).toBe(true)
		} finally {
			if (saved === undefined) delete process.env.GYC_TUI_BACKEND
			else process.env.GYC_TUI_BACKEND = saved
		}
	})

	test("shouldUseFallback(configRenderer)：opentui 禁用降级", () => {
		const saved = process.env.GYC_TUI_BACKEND
		try {
			delete process.env.GYC_TUI_BACKEND
			expect(shouldUseFallback(undefined)).toBe(true)
			expect(shouldUseFallback("fallback")).toBe(true)
			expect(shouldUseFallback("opentui")).toBe(false)
			expect(shouldUseFallback("auto")).toBe(true)
		} finally {
			if (saved === undefined) delete process.env.GYC_TUI_BACKEND
			else process.env.GYC_TUI_BACKEND = saved
		}
	})
})
