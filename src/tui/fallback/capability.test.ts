import { describe, expect, test } from "bun:test"
import { probeTerminal, renderBudget, sessionTargetFps, LARGE_SESSION_THRESHOLD, MIN_RENDER_FPS } from "./capability"

function makeEnv(overrides: Record<string, string | undefined>): Record<string, string | undefined> {
	return { TERM: "xterm-256color", ...overrides }
}

describe("终端能力探测", () => {
	test("GYCCODE_TUI_PLAIN=0 强制非 plain", () => {
		const probe = probeTerminal({ env: makeEnv({ GYCCODE_TUI_PLAIN: "0", TERM: "dumb" }) })
		expect(probe.plain).toBe(false)
	})

	test("GYCCODE_TUI_PLAIN=1 强制 plain", () => {
		const probe = probeTerminal({ env: makeEnv({ GYCCODE_TUI_PLAIN: "1" }) })
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
		const probe = probeTerminal({ env: makeEnv({ CI: undefined, GYCCODE_TUI_PLAIN: undefined, TERM_PROGRAM: undefined }) })
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

	test("会话规模超阈值时降档（plain 档）", () => {
		const probe = { plain: true, colorDepth: 8 as const, opaqueBg: true, platform: "linux" as const, termProgram: undefined }
		// 规模不超过阈值时与既有 plain 档一致
		expect(renderBudget(probe, { scale: LARGE_SESSION_THRESHOLD }).maxFps).toBe(10)
		// 超过阈值后降档，且不低于帧率下限
		const large = renderBudget(probe, { scale: LARGE_SESSION_THRESHOLD * 4 })
		expect(large.maxFps).toBeLessThan(10)
		expect(large.maxFps).toBeGreaterThanOrEqual(MIN_RENDER_FPS)
	})

	test("会话规模降档只影响帧率，不改鼠标/kitty 开关", () => {
		const probe = { plain: false, colorDepth: 24 as const, opaqueBg: true, platform: "linux" as const, termProgram: undefined }
		const base = renderBudget(probe, { scale: 0 })
		const large = renderBudget(probe, { scale: LARGE_SESSION_THRESHOLD * 4 })
		expect(large.mouseEnabled).toBe(base.mouseEnabled)
		expect(large.kittyKeyboard).toBe(base.kittyKeyboard)
		expect(large.maxFps).toBeLessThan(base.maxFps)
	})

	test("非法 scale 夹到保守值，等同于不降档", () => {
		const probe = { plain: true, colorDepth: 8 as const, opaqueBg: true, platform: "linux" as const, termProgram: undefined }
		const base = renderBudget(probe)
		for (const scale of [0, -1, Number.NaN, Number.POSITIVE_INFINITY]) {
			expect(renderBudget(probe, { scale }).maxFps).toBe(base.maxFps)
		}
	})

	test("不传 scale 时与既有行为完全一致", () => {
		const plain = { plain: true, colorDepth: 8 as const, opaqueBg: true, platform: "linux" as const, termProgram: undefined }
		const rich = { plain: false, colorDepth: 24 as const, opaqueBg: true, platform: "linux" as const, termProgram: undefined }
		expect(renderBudget(plain)).toEqual(renderBudget(plain, {}))
		expect(renderBudget(rich)).toEqual(renderBudget(rich, {}))
	})

	test("阈值与帧率下限常量均为正", () => {
		expect(LARGE_SESSION_THRESHOLD).toBeGreaterThan(0)
		expect(MIN_RENDER_FPS).toBeGreaterThan(0)
	})
})

describe("会话阶段帧率", () => {
	const plain = probeTerminal({ env: makeEnv({ TERM: "dumb", CI: undefined }) })
	const rich = probeTerminal({ env: makeEnv({ CI: undefined, TERM_PROGRAM: undefined }) })

	test("非 plain：流式 60fps / 空闲 30fps", () => {
		expect(sessionTargetFps(rich, true)).toBe(60)
		expect(sessionTargetFps(rich, false)).toBe(30)
	})

	test("plain：流式与空闲均为 10fps（renderBudget 的 plain 上限）", () => {
		// delta 合并窗口为 30ms（context/delta-flush.ts）：plain 终端跑 60fps
		// 纯属空转烧 CPU，对上屏节奏无任何肉眼差别，故直接贴住 maxFps 上限。
		expect(sessionTargetFps(plain, true)).toBe(10)
		expect(sessionTargetFps(plain, false)).toBe(10)
	})

	test("始终不超过 renderBudget 上限，空闲帧率不高于流式", () => {
		for (const probe of [plain, rich]) {
			const budget = renderBudget(probe)
			expect(sessionTargetFps(probe, true)).toBeLessThanOrEqual(budget.maxFps)
			expect(sessionTargetFps(probe, false)).toBeLessThanOrEqual(budget.maxFps)
			expect(sessionTargetFps(probe, false)).toBeLessThanOrEqual(sessionTargetFps(probe, true))
		}
	})
})
