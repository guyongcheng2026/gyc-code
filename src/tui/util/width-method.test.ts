import { describe, expect, test } from "bun:test"
import { forceWcwidth } from "./width-method"

describe("forceWcwidth", () => {
	test("设置 OPENTUI_FORCE_WCWIDTH=1", () => {
		const saved = process.env.OPENTUI_FORCE_WCWIDTH
		delete process.env.OPENTUI_FORCE_WCWIDTH
		try {
			forceWcwidth()
			expect(process.env.OPENTUI_FORCE_WCWIDTH === "1").toBe(true)
		} finally {
			if (saved === undefined) delete process.env.OPENTUI_FORCE_WCWIDTH
			else process.env.OPENTUI_FORCE_WCWIDTH = saved
		}
	})

	test("幂等：不覆盖已有值", () => {
		const saved = process.env.OPENTUI_FORCE_WCWIDTH
		process.env.OPENTUI_FORCE_WCWIDTH = "0"
		try {
			forceWcwidth()
			expect(process.env.OPENTUI_FORCE_WCWIDTH === "0").toBe(true)
		} finally {
			if (saved === undefined) delete process.env.OPENTUI_FORCE_WCWIDTH
			else process.env.OPENTUI_FORCE_WCWIDTH = saved
		}
	})
})
