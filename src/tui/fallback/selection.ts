/**
 * fallback 文本选择抽象。
 *
 * 与 Claude Code TUI 的 Selection 模块对齐：用户用鼠标拖选文本 → Ctrl+C
 * 复制到剪贴板 → Toast 通知。
 *
 * fallback 当前不支持原生 mouse drag（鼠标追踪虽启用但未做选择 UI），
 * 因此本模块提供两路：
 *  1. 程序化选择：app 主动 push 一段文本到 selection（用于 Ctrl+C 复制最后
 *     消息、复制当前行等快捷操作）
 *  2. 未来扩展：mouse drag → 物理选择范围（待 fallback 渲染器支持）
 *
 * 解耦点：selection 模型不依赖任何渲染器细节。剪贴板走 OSC 52 或
 * clipboardy 兜底（见 clipboard.ts）。
 */

import { copyToClipboard } from "./clipboard"

export type SelectionSource = "programmatic" | "mouse" | "keyboard"

export interface Selection {
	readonly text: string
	readonly source: SelectionSource
	readonly createdAt: number
}

export interface SelectionStore {
	/** 当前选中的文本（清空返回 null） */
	get(): Selection | null
	/** 显式清空 */
	clear(): void
	/** 程序化设置（覆盖前值） */
	setProgrammatic(text: string): void
}

/**
 * 创建选择存储。闭包持有 state，纯函数访问。
 */
export function createSelectionStore(): SelectionStore {
	let current: Selection | null = null
	return {
		get() {
			return current
		},
		clear() {
			current = null
		},
		setProgrammatic(text: string) {
			current = text.length > 0 ? { text, source: "programmatic", createdAt: Date.now() } : null
		},
	}
}

/**
 * 复制当前选择到剪贴板。返回 true 表示有内容被复制，false 表示无选择。
 */
export async function copySelection(store: SelectionStore): Promise<boolean> {
	const sel = store.get()
	if (!sel) return false
	await copyToClipboard(sel.text)
	return true
}

/**
 * 复制单段文本并更新选择状态（程序化选择 + 复制的复合操作）。
 */
export async function copyAndSelect(store: SelectionStore, text: string): Promise<boolean> {
	store.setProgrammatic(text)
	return copySelection(store)
}
