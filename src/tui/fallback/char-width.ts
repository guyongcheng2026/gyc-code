/**
 * 轻量字符串显示宽度计算（fallback 专用）。
 *
 * 替代 string-width@8.2.2 包：string-width@8 拖入 emoji-regex 等重依赖链，
 * 加载即占 8-10MB RSS。fallback 仅需"半角/全角"判定，无需 emoji ZWJ 链。
 *
 * 判定策略（与 string-width 默认口径一致，即终端实际显示宽度）：
 *  1. 控制字符（< 0x20 / 0x7F-0x9F）= 0
 *  2. 组合用音符等零宽字符 = 0（screen.ts 会把 0 落为 1 格占位，同旧行为）
 *  3. ASCII (0x20-0x7E) = 1
 *  4. CJK 统一汉字（U+4E00-U+9FFF）= 2
 *  5. CJK 扩展 A（U+3400-U+4DBF）= 2
 *  6. CJK 兼容表意（U+F900-U+FAFF）= 2
 *  7. CJK 符号与全角空格（U+3000-U+303F）= 2
 *  8. 假名全角（U+3040-U+30FF）= 2
 *  9. 谚文 Jamo（U+1100-U+11FF）与音节（U+AC00-U+D7AF）= 2
 *  10. 全角标点（U+FF01-U+FF60）与全角符号（U+FFE0-U+FFE6）= 2
 *  11. emoji（U+1F300-U+1FAFF）及修饰符/肤色 = 2
 *  12. 其它（含 box drawing │─、几何 █、箭头 →、弯引号 ‘’、省略号 … 等
 *      Ambiguous 字符）= 1——终端按半角显示，必须与终端口径一致，
 *      否则布局按 2 格、终端按 1 格渲染，逐字符右移累积成乱码。
 */

const COMBINING_FIRST = 0x0300
const COMBINING_LAST = 0x036f
const COMBINING_EXT_A_FIRST = 0x1ab0
const COMBINING_EXT_A_LAST = 0x1aff
const COMBINING_SUPP_FIRST = 0x20d0
const COMBINING_SUPP_LAST = 0x20ff
const COMBINING_HALF_FIRST = 0xfe20
const COMBINING_HALF_LAST = 0xfe2f
const ASCII_FIRST = 0x20
const ASCII_LAST = 0x7e
const CJK_SYMBOLS_FIRST = 0x3000
const CJK_SYMBOLS_LAST = 0x303f
const HIRAGANA_KATAKANA_FIRST = 0x3040
const HIRAGANA_KATAKANA_LAST = 0x30ff
const CJK_EXT_A_FIRST = 0x3400
const CJK_EXT_A_LAST = 0x4dbf
const CJK_UNIFIED_FIRST = 0x4e00
const CJK_UNIFIED_LAST = 0x9fff
const HANGUL_JAMO_FIRST = 0x1100
const HANGUL_JAMO_LAST = 0x11ff
const HANGUL_SYLLABLE_FIRST = 0xac00
const HANGUL_SYLLABLE_LAST = 0xd7af
const CJK_COMPAT_FIRST = 0xf900
const CJK_COMPAT_LAST = 0xfaff
const FULLWIDTH_PUNCT_FIRST = 0xff01
const FULLWIDTH_PUNCT_LAST = 0xff60
const FULLWIDTH_SYMBOL_FIRST = 0xffe0
const FULLWIDTH_SYMBOL_LAST = 0xffe6
const EMOJI_FIRST = 0x1f300
const EMOJI_LAST = 0x1faff
const EMOJI_MODIFIER_FIRST = 0x1f3fb
const EMOJI_MODIFIER_LAST = 0x1f3ff

function isCombining(code: number): boolean {
	return (
		(code >= COMBINING_FIRST && code <= COMBINING_LAST) ||
		(code >= COMBINING_EXT_A_FIRST && code <= COMBINING_EXT_A_LAST) ||
		(code >= COMBINING_SUPP_FIRST && code <= COMBINING_SUPP_LAST) ||
		(code >= COMBINING_HALF_FIRST && code <= COMBINING_HALF_LAST)
	)
}

/**
 * 计算单字符显示宽度。
 * 返回 0/1/2：0=不可见/零宽，1=半角，2=全角。
 */
export function charWidth(ch: string): 0 | 1 | 2 {
	if (ch.length === 0) return 0
	const code = ch.codePointAt(0)!
	if (code < ASCII_FIRST || (code >= 0x7f && code <= 0x9f)) return 0
	if (isCombining(code)) return 0
	if (code <= ASCII_LAST) return 1
	if (code >= HANGUL_JAMO_FIRST && code <= HANGUL_JAMO_LAST) return 2
	if (code >= CJK_SYMBOLS_FIRST && code <= CJK_SYMBOLS_LAST) return 2
	if (code >= HIRAGANA_KATAKANA_FIRST && code <= HIRAGANA_KATAKANA_LAST) return 2
	if (code >= CJK_EXT_A_FIRST && code <= CJK_EXT_A_LAST) return 2
	if (code >= CJK_UNIFIED_FIRST && code <= CJK_UNIFIED_LAST) return 2
	if (code >= HANGUL_SYLLABLE_FIRST && code <= HANGUL_SYLLABLE_LAST) return 2
	if (code >= CJK_COMPAT_FIRST && code <= CJK_COMPAT_LAST) return 2
	if (code >= FULLWIDTH_PUNCT_FIRST && code <= FULLWIDTH_PUNCT_LAST) return 2
	if (code >= FULLWIDTH_SYMBOL_FIRST && code <= FULLWIDTH_SYMBOL_LAST) return 2
	if (code >= EMOJI_FIRST && code <= EMOJI_LAST) return 2
	if (code >= EMOJI_MODIFIER_FIRST && code <= EMOJI_MODIFIER_LAST) return 2
	return 1
}

/**
 * 兼容原 string-width 签名（string 参数）。等价于所有字符宽度求和。
 */
export function stringWidth(s: string): number {
	let total = 0
	for (let i = 0; i < s.length; i++) {
		const cp = s.charCodeAt(i)
		if (cp >= 0xd800 && cp <= 0xdbff && i + 1 < s.length) {
			const lo = s.charCodeAt(i + 1)
			if (lo >= 0xdc00 && lo <= 0xdfff) {
				total += charWidth(String.fromCodePoint(cp, lo)) === 2 ? 2 : 1
				i++
				continue
			}
		}
		total += charWidth(s[i]!) === 2 ? 2 : 1
	}
	return total
}
