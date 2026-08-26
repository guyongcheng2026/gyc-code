import type { CellStyle, Screen } from "./screen"

/**
 * 富文本 token 模型（P1 引擎验收扩容）。
 *
 * 对齐 opentui：`@opentui/core/lib/tree-sitter-styled-text` 将 tree-sitter
 * 高亮 capture（scope 名列表）映射为 StyleDefinition。本模块提供同语义的
 * 纯 JS 等价物——把 scope 列表解析为 fallback 的 CellStyle，使富文本层
 * 快照矩阵可以在不加载 opentui 原生库的前提下验证样式渲染对齐。
 *
 * scope 规则镜像自 src/tui/theme/index.ts getSyntaxRules()（2026-08-26 摘录），
 * 仅保留代表性 capture；依赖注入语义（如基础文本色）由调用方提供。
 */

/** 树-sitter 高亮 token：文本 + 捕获 scope 列表（如 ["keyword", "keyword.return"]） */
export interface RichToken {
	readonly text: string
	readonly scopes: readonly string[]
}

/** 简化调色板：以 hex 字符串承载主题中与语法高亮相关的颜色。 */
export interface RichPalette {
	readonly text: string
	readonly syntaxComment: string
	readonly syntaxKeyword: string
	readonly syntaxFunction: string
	readonly syntaxVariable: string
	readonly syntaxString: string
	readonly syntaxNumber: string
	readonly syntaxType: string
	readonly syntaxOperator: string
	readonly syntaxPunctuation: string
	readonly markdownHeading: string
	readonly markdownCode: string
	readonly markdownCodeBg: string
	readonly diffAdded: string
	readonly diffAddedBg: string
	readonly diffRemoved: string
	readonly diffRemovedBg: string
}

const has = (scopes: readonly string[], scope: string): boolean => scopes.includes(scope)
const any = (scopes: readonly string[], ...names: readonly string[]): boolean => names.some((n) => scopes.includes(n))

/**
 * 解析 scope 列表为样式。判定顺序对齐主题规则优先级：
 * 注释最优先，其后按 字符串/数字/关键字族/运算符/类型/变量/标点 递进。
 * 未命中任何规则时返回 fallback（基础文本样式）。
 */
export function resolveTokenStyle(scopes: readonly string[], palette: RichPalette, fallback: CellStyle): CellStyle {
	if (scopes.length === 0) return fallback

	// 注释家族（含文档注释、error/warning/todo）
	if (any(scopes, "comment", "comment.documentation", "comment.error", "comment.warning", "comment.todo")) {
		return { fg: palette.syntaxComment, italic: true }
	}
	// 字符串/符号/字符
	if (any(scopes, "string", "symbol", "string.special", "character")) return { fg: palette.syntaxString }
	// 数字/布尔/浮点/常量
	if (any(scopes, "number", "boolean", "float", "constant")) return { fg: palette.syntaxNumber }
	// 关键字族细节分支必须先于通用 keyword
	if (has(scopes, "keyword.import")) return { fg: palette.syntaxKeyword }
	if (any(scopes, "keyword.return", "keyword.conditional", "keyword.repeat", "keyword.coroutine", "keyword.modifier")) {
		return { fg: palette.syntaxKeyword, italic: true }
	}
	if (has(scopes, "keyword.type")) return { fg: palette.syntaxType, bold: true, italic: true }
	if (any(scopes, "keyword.function", "function.method", "function", "constructor")) {
		return { fg: palette.syntaxFunction }
	}
	if (has(scopes, "keyword")) return { fg: palette.syntaxKeyword, italic: true }
	// 运算符/分隔符
	if (any(scopes, "operator", "keyword.operator", "punctuation.delimiter")) return { fg: palette.syntaxOperator }
	// 类型/命名空间
	if (any(scopes, "type", "module", "class", "namespace", "type.definition")) return { fg: palette.syntaxType }
	// 变量/字段/函数调用
	if (any(scopes, "variable", "variable.parameter", "function.method.call", "function.call", "property", "field", "parameter")) {
		return { fg: palette.syntaxVariable }
	}
	// 标点
	if (any(scopes, "punctuation", "punctuation.bracket")) return { fg: palette.syntaxPunctuation }
	// Markdown 与 diff 专用 capture
	if (has(scopes, "markup.heading")) return { fg: palette.markdownHeading, bold: true }
	if (any(scopes, "markup.raw", "markup.raw.block", "markup.raw.inline")) {
		return { fg: palette.markdownCode, bg: palette.markdownCodeBg }
	}
	if (has(scopes, "diff.plus")) return { fg: palette.diffAdded, bg: palette.diffAddedBg }
	if (has(scopes, "diff.minus")) return { fg: palette.diffRemoved, bg: palette.diffRemovedBg }
	if (any(scopes, "string.escape", "string.regexp")) return { fg: palette.syntaxKeyword }

	return fallback
}

/**
 * 逐 token 写入屏幕网格（顺序追加，不做换行）。
 * 返回终止列号，与 Screen.writeText 语义一致。
 */
export function writeRichText(screen: Screen, x: number, y: number, tokens: readonly RichToken[], palette: RichPalette): number {
	let cx = Math.max(0, x)
	for (const token of tokens) {
		cx = screen.writeText(cx, y, token.text, resolveTokenStyle(token.scopes, palette, { fg: palette.text }))
	}
	return cx
}

/** 测试与工具默认调色板（GitHub 暗色系近似值，仅作断言基准）。 */
export const DEFAULT_PALETTE: RichPalette = {
	text: "#24292e",
	syntaxComment: "#6a737d",
	syntaxKeyword: "#d73a49",
	syntaxFunction: "#005cc5",
	syntaxVariable: "#e36209",
	syntaxString: "#22863a",
	syntaxNumber: "#005cc5",
	syntaxType: "#6f42c1",
	syntaxOperator: "#005cc5",
	syntaxPunctuation: "#24292e",
	markdownHeading: "#005cc5",
	markdownCode: "#22863a",
	markdownCodeBg: "#f6f8fa",
	diffAdded: "#22863a",
	diffAddedBg: "#f0fff4",
	diffRemoved: "#cb2431",
	diffRemovedBg: "#ffeef0",
}