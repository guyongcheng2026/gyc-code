/**
 * fallback Toast 通知系统。
 *
 * 与 Claude Code Toast 对齐：操作反馈 + 错误提示 + 成功确认。
 * 非阻塞：Toast 入列后异步渲染，用户可继续操作。
 * 生命周期：入列 → 显示 duration ms → 淡出 → 出列。
 *
 * 渲染策略：
 *  - plain TTY：直接 print 到 stderr（避免干扰 stdout 渲染流）
 *  - 非 plain TTY：渲染到 fallback 组件（ScrollBox 底部或顶部覆盖层）
 *
 * 注意：Toast 在 fallback renderer 渲染循环之外——通过 backend.write() 直接输出，
 * 这保证 Toast 不会因为渲染器卡顿而延迟。
 */

export type ToastVariant = "info" | "success" | "error" | "warning"

export interface ToastOptions {
	variant?: ToastVariant
	/** 显示时长（ms），默认 3000，0=永久（需手动 dismiss） */
	duration?: number
	/** 标题（可选） */
	title?: string
}

export interface Toast extends ToastOptions {
	id: number
	text: string
	createdAt: number
}

const DEFAULT_DURATION = 3000
const TOAST_ID_BASE = Date.now()

/**
 * Toast 存储。典型用法：单例 export，app 层引用。
 */
export class ToastStore {
	private toasts: Toast[] = []
	private nextId = 0

	/**
	 * 推入一条 Toast。
	 * 返回 toast id，可用于 dismiss(id) 手动移除。
	 */
	add(text: string, options: ToastOptions = {}): number {
		const id = TOAST_ID_BASE + this.nextId++
		const toast: Toast = {
			id,
			text,
			variant: options.variant ?? "info",
			duration: options.duration ?? DEFAULT_DURATION,
			title: options.title,
			createdAt: Date.now(),
		}
		this.toasts.push(toast)
		this.scheduleAutoRemove(toast)
		return id
	}

	/** 移除指定 id */
	dismiss(id: number): void {
		this.toasts = this.toasts.filter((t) => t.id !== id)
	}

	/** 清空所有 */
	clear(): void {
		this.toasts = []
	}

	/** 当前所有 Toast（只读快照） */
	all(): readonly Toast[] {
		return this.toasts
	}

	private scheduleAutoRemove(toast: Toast): void {
		if (!toast.duration || toast.duration <= 0) return
		setTimeout(() => {
			this.dismiss(toast.id)
		}, toast.duration)
	}
}

const TOAST_PREFIXES: Record<ToastVariant, string> = {
	info: "[i]",
	success: "[✓]",
	error: "[✗]",
	warning: "[!]",
}

/**
 * 将 ToastStore 的当前状态渲染为纯文本行，追加到 stderr。
 * 典型用法：每帧渲染结束时调用一次（plain TTY 或 fallback 调试）。
 *
 * 格式（对齐 Claude Code Toast 风格）：
 *  [i] Title (可选)
 *  [i] message text
 */
export function renderToastsToStderr(store: ToastStore): void {
	const toasts = store.all()
	if (toasts.length === 0) return
	for (const t of toasts) {
		const variant = t.variant ?? "info"
		const prefix = TOAST_PREFIXES[variant]
		const line = t.title ? `${prefix} ${t.title}: ${t.text}` : `${prefix} ${t.text}`
		process.stderr.write(line + "\n")
	}
}
