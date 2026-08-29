import { describe, expect, test } from "bun:test"
import { probeTerminal, renderBudget } from "./capability"

function makeEnv(overrides: Record<string, string | undefined>): Record<string, string | undefined> {
	return { TERM: "xterm-256color", ...overrides }
}

describe("终端能力探测", () => {
	test("MIMOCODE_TUI_PLAIN=0 强制非 plain", () => {
		const probe = probeTerminal({ env: makeEnv({ MIMOCODE_TUI_PLAIN: "0", TERM: "dumb" }) })
		expect(probe.plain).toBe(false)
	})

	test("MIMOCODE_TUI_PLAIN=1 强制 plain", () => {
		const probe = probeTerminal({ env: makeEnv({ MIMOCODE_TUI_PLAIN: "1" }) })
		expect(probe.plain).toBe(true)
	})

	test("CI=true 自动 plain", () => {
		const probe = probeTerminal({ env: makeEnv({ CI: "true" }) })
		expect(probe.plain).toBe(true)
	})

	test("GITHUB_ACTIONS 自动 plain", () => {
		const probe = probeTerminal({ env: makeEnv({ GITHUB_ACTIONS: "true" }) })
		expect(probe.plain).toBe(true)
	})

	test("TERM=dumb 自动 plain", () => {
		const probe = probeTerminal({ env: makeEnv({ TERM: "dumb" }) })
		expect(probe.plain).toBe(true)
	})

	test("TERM=xterm-256color + 非 CI = 非 plain", () => {
		const probe = probeTerminal({ env: makeEnv({ CI: undefined, MIMOCODE_TUI_PLAIN: undefined, TERM_PROGRAM: undefined }) })
		expect(probe.plain).toBe(false)
		expect(probe.colorDepth).toBe(8)
	})

	test("COLORTERM=truecolor → 24bit", () => {
		const probe = probeTerminal({ env: makeEnv({ COLORTERM: "truecolor", CI: undefined }) })
		expect(probe.colorDepth).toBe(24)
	})

	test("NO_COLOR 降级到 8bit", () => {
		const probe = probeTerminal({ env: makeEnv({ NO_COLOR: "1", COLORTERM: "truecolor" }) })
		expect(probe.colorDepth).toBe(8)
	})
})

describe("渲染预算", () => {
	test("plain TTY → maxFps=10, 关闭鼠标/kitty", () => {
		const budget = renderBudget({ plain: true, colorDepth: 8, opaqueBg: true, platform: "linux", termProgram: undefined })
		expect(budget.maxFps).toBe(10)
		expect(budget.mouseEnabled).toBe(false)
		expect(budget.kittyKeyboard).toBe(false)
	})

	test("非 plain → maxFps=60, 启用鼠标/kitty", () => {
		const budget = renderBudget({ plain: false, colorDepth: 24, opaqueBg: true, platform: "linux", termProgram: "iTerm.app" })
		expect(budget.maxFps).toBe(60)
		expect(budget.mouseEnabled).toBe(true)
		expect(budget.kittyKeyboard).toBe(true)
	})
})
