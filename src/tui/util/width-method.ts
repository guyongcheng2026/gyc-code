/**
 * 强制 opentui 原生侧使用 wcwidth 计算字符宽度。
 *
 * 根因：opentui 原生 buffer 默认 widthMethod="unicode"，与 JS 侧布局测量
 * （Bun.stringWidth / string-width，wcwidth 口径）不一致，CJK/emoji 宽度
 * 判定分歧导致中文错位、重叠、花屏。OPENTUI_FORCE_WCWIDTH 是 opentui
 * 官方环境开关，使原生侧与 JS 侧统一为 wcwidth 口径。
 *
 * 必须在 createCliRenderer 之前调用（能力探测发生在渲染器创建时）。
 */
export function forceWcwidth(): void {
	if (!process.env.OPENTUI_FORCE_WCWIDTH) {
		process.env.OPENTUI_FORCE_WCWIDTH = "1"
	}
}
