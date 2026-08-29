import type { Screen } from "./screen.js"

/**
 * 把 Screen 渲染为纯文本行（每行按列宽拼接 cell.ch）。
 * 宽字符（width=2）占位列 ch 为空，不影响字形。
 * 独立成纯函数：1) 终端快照比对复用；2) Screen 类职责收敛到 buffer/写入/克隆。
 */
export function renderScreenToLines(screen: Screen): string[] {
	const lines: string[] = []
	for (let y = 0; y < screen.height; y++) {
		let line = ""
		for (let x = 0; x < screen.width; x++) {
			line += screen.cellAt(x, y).ch
		}
		lines.push(line)
	}
	return lines
}
