import type { CellStyle } from "./screen"
import type { StyledSpan } from "./solid/paint"

/**
 * slice B：通用代码高亮器（零依赖、零原生——不引 tree-sitter）。
 *
 * 设计：正则 tokenizer，覆盖 ts/js/tsx/json/python/shell 的公共语法集。
 * 与 opentui 的 Code renderable（tree-sitter 原生）相比：
 * - 精度：语法级近似（无 AST），视觉覆盖关键字/字符串/注释/数字/函数调用
 * - 性能：纯正则，无 FFI 开销，流式文本重渲成本可控
 *
 * md 代码块（markdown.ts）与未来 Code 组件共用本高亮器。
 */

/** 高亮配色（GitHub 暗色近似，全中文注释与 rich-text.ts 口径同源）。 */
const HL = {
	/** 关键字：红 */
	keyword: { fg: "#d73a49" },
	/** 字符串：绿 */
	string: { fg: "#22863a" },
	/** 注释：灰 + 斜体 */
	comment: { fg: "#6a737d", italic: true },
	/** 数字：蓝 */
	number: { fg: "#005cc5" },
	/** 函数调用：蓝 */
	fn: { fg: "#6f42c1" },
	/** 类型：紫 */
	type: { fg: "#6f42c1" },
	/** 普通文本 */
	plain: {},
} as const satisfies Record<string, CellStyle>

/** 各语言关键字集（按 fence 语言或扩展名路由；未命中走通用集）。 */
const KEYWORDS: Record<string, readonly string[]> = {
	ts: ["const", "let", "var", "function", "return", "if", "else", "for", "while", "class", "extends", "implements", "interface", "type", "enum", "import", "from", "export", "default", "async", "await", "new", "this", "super", "typeof", "instanceof", "in", "of", "try", "catch", "finally", "throw", "switch", "case", "break", "continue", "static", "public", "private", "protected", "readonly", "as", "satisfies", "void", "never", "unknown", "any", "string", "number", "boolean", "null", "undefined", "true", "false"],
	js: ["const", "let", "var", "function", "return", "if", "else", "for", "while", "class", "extends", "import", "from", "export", "default", "async", "await", "new", "this", "typeof", "instanceof", "try", "catch", "finally", "throw", "switch", "case", "break", "continue", "null", "undefined", "true", "false"],
	tsx: ["const", "let", "var", "function", "return", "if", "else", "for", "while", "class", "extends", "interface", "type", "import", "from", "export", "default", "async", "await", "new", "this", "typeof", "try", "catch", "throw", "null", "undefined", "true", "false"],
	json: ["true", "false", "null"],
	py: ["def", "class", "return", "if", "elif", "else", "for", "while", "import", "from", "as", "with", "try", "except", "finally", "raise", "pass", "break", "continue", "lambda", "yield", "global", "nonlocal", "assert", "del", "in", "is", "not", "and", "or", "None", "True", "False", "self", "async", "await"],
	python: ["def", "class", "return", "if", "elif", "else", "for", "while", "import", "from", "as", "with", "try", "except", "finally", "raise", "pass", "break", "continue", "lambda", "yield", "None", "True", "False", "self"],
	sh: ["if", "then", "else", "elif", "fi", "for", "while", "do", "done", "case", "esac", "function", "return", "local", "export", "echo", "cd", "set", "unset"],
	bash: ["if", "then", "else", "elif", "fi", "for", "while", "do", "done", "case", "esac", "function", "return", "local", "export", "echo", "cd"],
}

const alias: Record<string, string> = { javascript: "js", typescript: "ts", jsx: "js", shell: "sh", zsh: "sh", "c++": "ts", cpp: "ts", c: "ts", java: "ts", go: "ts", rust: "ts", rs: "ts" }

/** 词法 token 识别顺序：注释（// 与 #，# 由 hashComment 开关控制消费）→ 字符串 → 数字 → 标识符 → 其他。 */
const TOKEN_RE = /(\/\/[^\n]*|#[^\n]*|"(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*'|`(?:[^`\\]|\\.)*`|\b\d+(?:\.\d+)?\b|[A-Za-z_$][\w$]*|\s+|.)/g

/** 判定标识符样式：关键字 → 类型 → 函数调用 → 普通。 */
function identStyle(word: string, keywords: ReadonlySet<string>, nextChar: string | undefined): CellStyle {
	if (keywords.has(word)) return HL.keyword
	if (/^[A-Z]/.test(word)) return HL.type
	if (nextChar === "(") return HL.fn
	return HL.plain
}

/** 单行代码高亮：返回 StyledSpan[]。lang 未识别时走 ts 通用集。 */
export function highlightCodeLine(line: string, lang: string): StyledSpan[] {
	const key = alias[lang] ?? lang
	const words = KEYWORDS[key] ?? KEYWORDS.ts
	const keywords = new Set(words)
	// python 用 # 注释；其他语言 # 不是注释（ts 里是私有字段）——按语言开关
	const hashComment = key === "py" || key === "python" || key === "sh" || key === "bash"

	const spans: StyledSpan[] = []
	const push = (text: string, style: CellStyle) => {
		const last = spans[spans.length - 1]
		if (last !== undefined && last.style === style) spans[spans.length - 1] = { text: last.text + text, style }
		else spans.push({ text, style })
	}
	if (line.length === 0) return [{ text: "", style: HL.plain }]

	TOKEN_RE.lastIndex = 0
	let m: RegExpExecArray | null
	while ((m = TOKEN_RE.exec(line)) !== null) {
		const t = m[0]!
		if (t.startsWith("//") || (hashComment && t.startsWith("#"))) {
			push(t, HL.comment)
		} else if (t.startsWith('"') || t.startsWith("'") || t.startsWith("`")) {
			push(t, HL.string)
		} else if (/^\d/.test(t)) {
			push(t, HL.number)
		} else if (/^[A-Za-z_$]/.test(t)) {
			const next = line[TOKEN_RE.lastIndex]
			push(t, identStyle(t.replace(/!$/, ""), keywords, next))
		} else {
			push(t, HL.plain)
		}
	}
	return spans
}

/** 高亮整段代码（markdown 代码块体用）。 */
export function highlightCodeBlock(code: string, lang: string): StyledSpan[][] {
	return code.split("\n").map((line) => highlightCodeLine(line, lang))
}
