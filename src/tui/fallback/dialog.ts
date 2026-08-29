/**
 * fallback Dialog 遮罩组件。
 *
 * 与 Claude Code Dialog 对齐：确认框 / 选择框，遮罩终端主内容，阻塞用户操作。
 * 实现为纯函数（无状态组件），由 app 层决定 open/close。
 *
 * 渲染策略：
 *  - 非 plain TTY：渲染半透明遮罩 + 居中 dialog 框（使用 SGR 反色 + 边框）
 *  - plain TTY：降级为 print-to-stderr 确认提示（用户输入 y/n）
 *
 * 支持组件：
 *  - confirm(title, message): 确认/取消 → Promise<boolean>
 *  - select(title, options[]): 单选列表 → Promise<string | null>
 *
 * 注意：
 *  - Dialog 渲染走 backend.write()（直接写 stdout），不经过 present() 帧循环，
 *    保证 Dialog 显示不受渲染器状态影响。
 *  - closeDialog() 清除遮罩：输出 \x1b[2J 清屏 + 恢复主内容。
 */

import type { TerminalBackend } from "./terminal"
import { probeTerminal } from "./capability"

export type DialogType = "confirm" | "select"

export interface ConfirmOptions {
	title?: string
	defaultValue?: boolean
}

export interface SelectOption {
	label: string
	value: string
}

const CLEAR_SEQ = "\x1b[2J\x1b[H"
const ENTER_SEQ = "\x1b[?1049h"
const LEAVE_SEQ = "\x1b[?1049h\x1b[2J\x1b[H"

function box(title: string, body: string[]): string {
	const W = Math.min(60, process.stdout.columns ?? 60)
	const inner = W - 4
	const top = "┌" + "─".repeat(inner) + "┐"
	const mid = body.map((l) => {
		const trunc = l.length > inner ? l.slice(0, inner - 3) + "..." : l
		return "│ " + trunc.padEnd(inner) + " │"
	})
	const bottom = "└" + "─".repeat(inner) + "┘"
	const titleLine = `│ ${title.padEnd(inner)} │`
	return [top, titleLine, "├" + "─".repeat(inner) + "┤", ...mid, bottom].join("\n")
}

async function readLine(): Promise<string> {
	return new Promise((resolve) => {
		process.stdin.once("data", (chunk: Buffer) => {
			const line = chunk.toString("utf8").trim()
			resolve(line)
		})
	})
}

async function readChar(chars: string[]): Promise<string> {
	return new Promise((resolve) => {
		process.stdin.once("data", (chunk: Buffer) => {
			const ch = chunk.toString("utf8").trim().toLowerCase()
			resolve(chars.includes(ch) ? ch : "")
		})
	})
}

/**
 * 确认对话框。
 *  - plain TTY：直接 print y/n 提示
 *  - 非 plain TTY：渲染 ASCII 框
 */
export async function confirmDialog(
	backend: TerminalBackend,
	message: string,
	options: ConfirmOptions = {},
): Promise<boolean> {
	const title = options.title ?? "确认"
	const defaultStr = options.defaultValue === false ? "[y/N]" : "[Y/n]"
	const promptStr = `${title}：${message} ${defaultStr} `

	const isPlain = probeTerminal().plain
	if (isPlain) {
		process.stdout.write(CLEAR_SEQ)
		process.stdout.write(promptStr)
		const input = await readLine()
		if (!input) return options.defaultValue ?? false
		return input.toLowerCase() === "y"
	}

	const lines = message.split("\n")
	const dialogText = box(title, [...lines, "", `  ${defaultStr}  →  `])

	backend.write(ENTER_SEQ)
	process.stdout.write(dialogText)

	const ynChars = ["y", "n"]
	const ch = await readChar(ynChars)
	backend.write(LEAVE_SEQ)

	if (!ch) return options.defaultValue ?? false
	return ch === "y"
}

/**
 * 单选列表对话框。
 */
export async function selectDialog(
	backend: TerminalBackend,
	title: string,
	options: SelectOption[],
): Promise<string | null> {
	if (options.length === 0) return null

	const lines = options.map((o, i) => `  ${i + 1}. ${o.label}`)
	const dialogText = box(title, [...lines, "", `  [Esc 取消]  →  `])

	backend.write(ENTER_SEQ)
	process.stdout.write(dialogText)

	const digits = options.map((_, i) => String(i + 1))
	const ch = await readChar(digits)
	backend.write(LEAVE_SEQ)

	if (!ch) return null
	const idx = parseInt(ch, 10) - 1
	return options[idx]?.value ?? null
}
