/**
 * 终端能力检测。
 *
 * 三个核心信号：plain TTY、color depth、alternate screen 支持。
 * 决策策略与 Claude Code TUI 对齐：plain TTY 自适应降频 + 简化渲染，
 * 防止 CPU 100% 与低端终端卡顿。
 *
 * 触发 plain 模式的判定（任一满足）：
 *  1. TERM=dumb（最明确）
 *  2. Apple_Terminal（macOS 原生终端，opaque bg + 无 true color）
 *  3. CI 环境（CI=true / GITHUB_ACTIONS / GITLAB_CI / JENKINS_URL）
 *  4. 显式开关 MIMOCODE_TUI_PLAIN=1/0（用户/测试覆盖）
 */

export interface TerminalProbe {
	/** 是否为 plain TTY（无丰富渲染能力） */
	plain: boolean
	/** 推断的 color depth */
	colorDepth: 0 | 8 | 16 | 24
	/** 推断的 background mode：opaque（不透明）=true / transparent */
	opaqueBg: boolean
	/** 平台（仅用于调试与日志） */
	platform: NodeJS.Platform
	/** 终端程序（仅用于调试） */
	termProgram: string | undefined
}

const PLAIN_TERMS = new Set(["dumb", "unknown"])
const OPAQUE_TERM_PROGRAMS = new Set(["Apple_Terminal"])

function isCi(env: NodeJS.ProcessEnv): boolean {
	if (env.CI === "true" || env.CI === "1") return true
	if (env.GITHUB_ACTIONS || env.GITLAB_CI || env.JENKINS_URL) return true
	return false
}

function detectPlain(env = process.env): boolean {
	const override = env.MIMOCODE_TUI_PLAIN
	if (override === "0" || override === "false") return false
	if (override === "1" || override === "true") return true
	if (isCi(env)) return true
	if (env.TERM && PLAIN_TERMS.has(env.TERM)) return true
	if (env.TERM_PROGRAM && OPAQUE_TERM_PROGRAMS.has(env.TERM_PROGRAM)) return true
	return false
}

function detectColorDepth(env = process.env): 0 | 8 | 16 | 24 {
	if (env.NO_COLOR) return 8
	if (env.COLORTERM === "truecolor" || env.COLORTERM === "24bit") return 24
	if (env.TERM?.includes("256color")) return 8
	if (env.TERM_PROGRAM) return 8 // 已知有色彩的终端保守 256
	return 8
}

function detectOpaqueBg(env = process.env): boolean {
	if (env.TERM_PROGRAM && OPAQUE_TERM_PROGRAMS.has(env.TERM_PROGRAM)) return true
	return true // 默认不透明（绘制 bg 颜色更安全）
}

/**
 * 探测当前终端能力。
 * 纯函数 + 显式 env 注入（测试用）。
 */
export function probeTerminal(input?: { env?: NodeJS.ProcessEnv; platform?: NodeJS.Platform }): TerminalProbe {
	const env = input?.env ?? process.env
	const plain = detectPlain(env)
	const colorDepth = plain ? 8 : detectColorDepth(env)
	return {
		plain,
		colorDepth,
		opaqueBg: detectOpaqueBg(env),
		platform: input?.platform ?? process.platform,
		termProgram: env.TERM_PROGRAM,
	}
}

/**
 * 根据 probe 结果推荐渲染参数。
 * 与 Claude Code rendererConfig 对齐：plain → maxFps 10-15, 非 plain → 60。
 */
export interface RenderBudget {
	/** 单 tick 内允许的帧数（0 = 不限） */
	maxFps: number
	/** 是否启用 SGR 鼠标追踪（plain TTY 关闭以省 CPU） */
	mouseEnabled: boolean
	/** 是否启用 kitty keyboard protocol（plain TTY 关闭） */
	kittyKeyboard: boolean
}

export function renderBudget(probe: TerminalProbe): RenderBudget {
	if (probe.plain) {
		return { maxFps: 10, mouseEnabled: false, kittyKeyboard: false }
	}
	return { maxFps: 60, mouseEnabled: true, kittyKeyboard: true }
}
