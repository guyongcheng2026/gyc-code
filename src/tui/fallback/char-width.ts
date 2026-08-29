/**
 * 轻量字符串显示宽度计算（fallback 专用）。
 *
 * 替代 string-width@8.2.2 包：string-width@8 拖入 emoji-regex 等重依赖链，
 * 加载即占 8-10MB RSS。fallback 仅需"半角/全角"判定，无需 emoji ZWJ 链。
 *
 * 判定策略（按 Wcwidth East Asian Width 标准）：
 *  1. 控制字符（< 0x20）= 0
 *  2. ASCII (0x20-0x7E) = 1
 *  3. CJK 统一汉字（U+4E00-U+9FFF）= 2
 *  4. CJK 扩展 A（U+3400-U+4DBF）= 2
 *  5. 标点全角（U+FF01-U+FF60）= 2
 *  6. 假名全角（U+3040-U+30FF）= 2
 *  7. 谚文音节（U+AC00-U+D7AF，한국어 类）= 2
 *  8. emoji 范围（U+1F300-U+1F9FF）= 2
 *  9. 其它 BMP = 1（保守）
 */

const ASCII_FIRST = 0x20
const ASCII_LAST = 0x7e
const CJK_FIRST = 0x4e00
const CJK_LAST = 0x9fff
const CJK_EXT_A_FIRST = 0x3400
const CJK_EXT_A_LAST = 0x4dbf
const FULLWIDTH_PUNCT_FIRST = 0xff01
const FULLWIDTH_PUNCT_LAST = 0xff60
const HIRAGANA_KATAKANA_FIRST = 0x3040
const HIRAGANA_KATAKANA_LAST = 0x30ff
const HANGUL_SYLLABLE_FIRST = 0xac00
const HANGUL_SYLLABLE_LAST = 0xd7af
const EMOJI_PICTOGRAPHS_FIRST = 0x1f300
const EMOJI_PICTOGRAPHS_LAST = 0x1f9ff

/**
 * 计算单字符显示宽度。
 * 返回 0/1/2：0=不可见，1=半角，2=全角。
 */
export function charWidth(ch: string): 0 | 1 | 2 {
	if (ch.length === 0) return 0
	const code = ch.codePointAt(0)!
	if (code < ASCII_FIRST) return 0
	if (code <= ASCII_LAST) return 1
	if (code >= CJK_FIRST && code <= CJK_LAST) return 2
	if (code >= CJK_EXT_A_FIRST && code <= CJK_EXT_A_LAST) return 2
	if (code >= FULLWIDTH_PUNCT_FIRST && code <= FULLWIDTH_PUNCT_LAST) return 2
	if (code >= HIRAGANA_KATAKANA_FIRST && code <= HIRAGANA_KATAKANA_LAST) return 2
	if (code >= HANGUL_SYLLABLE_FIRST && code <= HANGUL_SYLLABLE_LAST) return 2
	if (code >= EMOJI_PICTOGRAPHS_FIRST && code <= EMOJI_PICTOGRAPHS_LAST) return 2
	// emoji 修饰符 / 肤色 / ZWJ：保守给 2（不影响布局，主要出现在消息区）
	if (code >= 0x1f3fb && code <= 0x1f3ff) return 2
	if (code >= 0x200d) return 2
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
