/**
 * 终端剪贴板写入：OSC 52 escape sequence。
 *
 * 协议：`\x1b]52;c;<base64>\x07` —— 将 base64 编码的文本写入系统剪贴板。
 * 支持的终端：Windows Terminal、iTerm2、WezTerm、Kitty、Alacritty 等主流终端。
 * 旧版 cmd.exe 不支持，fallback 时静默失败（用户感知为无操作）。
 *
 * 明确不做：剪贴板读取（OSC 52 读）—— 终端安全限制 + 多数终端不响应读请求。
 */

/** OSC 52 每次最大 base64 长度（留余量给序列前缀） */
const MAX_BASE64_CHUNK = 4800

export function copyToClipboardViaOsc52(text: string): void {
	if (text.length === 0) return
	const base64 = encodeBase64(text)
	const chunks = chunkString(base64, MAX_BASE64_CHUNK)
	for (const chunk of chunks) {
		process.stdout.write(`\x1b]52;c;${chunk}\x07`)
	}
}

/**
 * 统一剪贴板入口：当前仅 OSC 52，未来加 clipboardy/pbcopy 兜底时改这里。
 * 返回 true 表示已发送（OSC 52 总能发送）；false 表示空文本无操作。
 */
export function copyToClipboard(text: string): boolean {
	if (text.length === 0) return false
	copyToClipboardViaOsc52(text)
	return true
}

/**
 * 基础 Base64 编码（Bun/Node 兼容）。
 * Buffer 在 Node 与 Bun 中均可用，统一优先 Buffer。
 */
function encodeBase64(text: string): string {
	if (typeof Buffer !== "undefined") {
		return Buffer.from(text, "utf8").toString("base64")
	}
	const bytes = new TextEncoder().encode(text)
	let binary = ""
	for (const byte of bytes) binary += String.fromCharCode(byte)
	return globalThis.btoa(binary)
}

/** 将字符串按固定长度分块 */
function chunkString(s: string, size: number): string[] {
	const out: string[] = []
	for (let i = 0; i < s.length; i += size) out.push(s.slice(i, i + size))
	return out
}
