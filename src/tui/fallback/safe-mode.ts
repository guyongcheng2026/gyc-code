import { DemoApp } from "./demo-app"
import { ProcessBackend, type TerminalBackend } from "./terminal"

/**
 * 安全模式：opentui 渲染器创建失败时的自动降级通道。
 *
 * 变「黑屏退出」为「可用保底」：展示错误摘要与基础交互界面，
 * 谷总仍可查看诊断信息并输入文本（回显确认终端通路完好）。
 *
 * 开关：GYC_TUI_BACKEND = opentui（禁用降级）| fallback | auto（默认）。
 */

export function shouldUseFallback(): boolean {
	return process.env.GYC_TUI_BACKEND !== "opentui"
}

export interface SafeModeOptions {
	/** 触发降级的错误 */
	error: unknown
	/** 产品名与版本，用于标题条 */
	productLabel?: string
	backend?: TerminalBackend
}

function formatError(error: unknown): string {
	if (error instanceof Error) return `${error.name}: ${error.message}`
	return String(error)
}

/**
 * 运行安全模式直至用户退出（Esc/Ctrl+C）。
 * 返回 true 表示用户已通过安全模式正常退出。
 */
export async function runFallbackSafeMode(options: SafeModeOptions): Promise<boolean> {
	const backend = options.backend ?? new ProcessBackend(process.stdout, process.stdin)
	const label = options.productLabel ?? "gyc-code"
	const app = new DemoApp({
		backend,
		title: `${label} · 安全模式`,
		initialMessages: [
			"系统: opentui 渲染器初始化失败，已自动降级到内置安全模式",
			`错误: ${formatError(options.error).slice(0, 200)}`,
			"说明: 本界面为纯 JS 差分帧渲染器，不依赖原生库",
			"操作: 输入文字回车可测试终端通路；Esc 或 Ctrl+C 退出",
			"恢复: 重启终端或检查 GYC_TUI_BACKEND 环境变量后重试 gyc tui",
		],
	})
	app.run()
	await new Promise<void>((resolve) => {
		const timer = setInterval(() => {
			if (app.isDone) {
				clearInterval(timer)
				resolve()
			}
		}, 100)
	})
	return true
}
