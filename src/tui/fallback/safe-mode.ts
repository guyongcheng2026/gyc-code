import { DemoApp } from "./demo-app"
import { ProcessBackend, type TerminalBackend } from "./terminal"

/**
 * 安全模式：opentui 渲染器创建失败或运行中原生崩溃时的自动降级通道。
 *
 * 变「黑屏退出」为「可用保底」：展示错误摘要与基础交互界面，
 * 谷总仍可查看诊断信息并输入文本（回显确认终端通路完好）。
 *
 * 开关：GYC_TUI_BACKEND =
 *   - 未设置/非法值（默认）：auto——opentui 优先，失败时自动降级 fallback
 *   - "fallback"：显式自研后端
 *   - "auto"：同默认
 *   - "opentui"：纯 opentui，禁用一切降级
 */

/** GYC_TUI_BACKEND 解析结果。 */
export type TuiBackendChoice = "opentui" | "fallback" | "auto"

export function backendChoice(): TuiBackendChoice {
	const value = process.env.GYC_TUI_BACKEND
	if (value === "opentui" || value === "fallback" || value === "auto") return value
	// 默认 auto：opentui 优先，失败自动降级 fallback
	return "auto"
}

/** 是否允许失败时自动降级到安全模式（opentui 显式禁用）。 */
export function shouldUseFallback(): boolean {
	return backendChoice() !== "opentui"
}

/** 是否显式强制使用自研 fallback 后端（区别于 S2 默认值，供日志归因）。 */
export function isExplicitFallback(): boolean {
	return process.env.GYC_TUI_BACKEND === "fallback"
}

/**
 * 一次性降级护栏：整个进程生命周期只允许进入安全模式一次。
 * 防止「崩溃 → 降级 → 安全模式内再崩 → 再降级」的循环。
 */
let fallbackClaimed = false

export function claimFallbackOnce(): boolean {
	if (fallbackClaimed) return false
	fallbackClaimed = true
	return true
}

/** 仅供测试重置护栏状态。 */
export function resetFallbackClaimForTest(): void {
	fallbackClaimed = false
}

/** 终端关闭检测挂载器签名（默认实现为 terminal-win32 的跨平台 watchTerminalClose）。 */
export type CloseWatcher = (onClose: () => void) => () => void

export interface SafeModeOptions {
	/** 触发降级的错误 */
	error: unknown
	/** 产品名与版本，用于标题条 */
	productLabel?: string
	backend?: TerminalBackend
	/** 终端关闭检测注入点（测试用）；默认 watchTerminalClose */
	watchClose?: CloseWatcher
}

function formatError(error: unknown): string {
	if (error instanceof Error) return `${error.name}: ${error.message}`
	return String(error)
}

/**
 * 运行安全模式直至用户退出（Esc/Ctrl+C）或终端窗口关闭。
 * 返回 true 表示已通过安全模式正常收场。
 */
export async function runFallbackSafeMode(options: SafeModeOptions): Promise<boolean> {
	const backend = options.backend ?? new ProcessBackend(process.stdout, process.stdin)
	const label = options.productLabel ?? "gyc-code"
	const app = new DemoApp({
		backend,
		title: `${label} · 安全模式`,
		initialMessages: [
			"系统: opentui 渲染器异常，已自动降级到内置安全模式",
			`错误: ${formatError(options.error).slice(0, 200)}`,
			"说明: 本界面为纯 JS 差分帧渲染器，不依赖原生库",
			"操作: 输入文字回车可测试终端通路；Esc 或 Ctrl+C 退出",
			"恢复: 重启终端或检查 GYC_TUI_BACKEND 环境变量后重试 gyc tui",
		],
	})
	app.run()
	// 孤儿进程防护：渲染器成功路径上的关闭检测此时未挂载，此处补齐
	let offWatchClose: (() => void) | undefined
	try {
		const { watchTerminalClose } = await import("../terminal-win32")
		const watcher = options.watchClose ?? watchTerminalClose
		offWatchClose = watcher(() => app.stop())
	} catch {}
	await new Promise<void>((resolve) => {
		const timer = setInterval(() => {
			if (app.isDone) {
				clearInterval(timer)
				resolve()
			}
		}, 100)
	})
	offWatchClose?.()
	return true
}
