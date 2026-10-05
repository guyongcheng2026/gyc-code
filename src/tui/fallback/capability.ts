/**
 * 终端能力检测。
 *
 * 三个核心信号：plain TTY、color depth、alternate screen 支持。
 * 决策策略：plain TTY 自适应降频 + 简化渲染，
 * 防止 CPU 100% 与低端终端卡顿。
 *
 * 触发 plain 模式的判定（任一满足）：
 *  1. TERM=dumb（最明确）
 *  2. Apple_Terminal（macOS 原生终端，opaque bg + 无 true color）
 *  3. CI 环境（CI=true / GITHUB_ACTIONS / GITLAB_CI / JENKINS_URL）
 *  4. 显式开关 GYCCODE_TUI_PLAIN=1/0（用户/测试覆盖）
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
	const override = env.GYCCODE_TUI_PLAIN
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
 * plain → maxFps 10-15, 非 plain → 60。
 */
export interface RenderBudget {
	/** 单 tick 内允许的帧数（0 = 不限） */
	maxFps: number
	/** 是否启用 SGR 鼠标追踪（plain TTY 关闭以省 CPU） */
	mouseEnabled: boolean
	/** 是否启用 kitty keyboard protocol（plain TTY 关闭） */
	kittyKeyboard: boolean
}

/**
 * 会话规模超过该阈值后开始降档。
 *
 * 取「一条消息平均占用若干渲染节点」的量级：会话里渲染的节点越多，每帧要重绘的
 * 内容就越多，帧率必须让路。低于阈值时行为与接入本维度之前完全一致。
 */
export const LARGE_SESSION_THRESHOLD = 200

/** 降档后的帧率下限。再低就没有可读性了，宁可卡也不做成幻灯片。 */
export const MIN_RENDER_FPS = 5

/** 会话规模维度：会话内累计渲染的节点数（消息数 × 节点系数）。 */
export interface RenderScale {
	/**
	 * 会话规模。不传、0、负数、NaN、Infinity 一律按「未启用」处理，
	 * 即完全不降档 —— 保证调用方不接入本维度时行为零变化。
	 */
	readonly scale?: number | undefined
}

/**
 * 按会话规模把基准帧率往下压，但不得低于 MIN_RENDER_FPS。
 *
 * 压法是「超阈值部分每达到阈值的一倍再降一档」，越大的会话降得越多，
 * 但不会线性归零。非有限值与未启用一律返回原帧率。
 */
function scaleDownFps(maxFps: number, scale: number | undefined): number {
	if (scale === undefined || !Number.isFinite(scale) || scale <= 0) return maxFps
	if (scale <= LARGE_SESSION_THRESHOLD) return maxFps
	const tiers = Math.floor(scale / LARGE_SESSION_THRESHOLD) - 1
	return Math.max(MIN_RENDER_FPS, Math.floor(maxFps / (1 + tiers)))
}

/**
 * 渲染预算。
 *
 * 两档基准沿用既有判定（plain / 非 plain），本函数只在其上叠加会话规模维度：
 * 降档只动 `maxFps`，**不改** `mouseEnabled` 与 `kittyKeyboard` —— 后两者是终端能力，
 * 与会话多大无关。
 */
export function renderBudget(probe: TerminalProbe, scale: RenderScale = {}): RenderBudget {
	if (probe.plain) {
		return { maxFps: scaleDownFps(10, scale.scale), mouseEnabled: false, kittyKeyboard: false }
	}
	return { maxFps: scaleDownFps(60, scale.scale), mouseEnabled: true, kittyKeyboard: true }
}

/**
 * 会话页按渲染阶段给出的目标帧率。
 *
 * 此前会话页把 60/30 写死，忽略了 probe 结果：plain 终端（TERM=dumb / CI）同样
 * 跑 60fps，而这类终端既无富渲染能力又常跑在受限容器里，属纯浪费。
 *
 * 上限取 renderBudget(probe).maxFps，保证任何阶段都不超过终端能力档位；
 * 流式期取上限，空闲期减半控制 CPU。
 */
export function sessionTargetFps(probe: TerminalProbe, streaming: boolean): number {
	const budget = renderBudget(probe)
	// 空闲期减半控制 CPU（下限 10fps：低于此值终端本身响应会发涩）
	if (!streaming) return Math.max(10, Math.floor(budget.maxFps / 2))
	return budget.maxFps
}
