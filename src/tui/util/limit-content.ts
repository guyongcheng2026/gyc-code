/**
 * 单条消息内容（正文 / 思维链 / diff）的行数与字节上限。
 *
 * 背景：消息虚拟化（virtual-window.ts）只裁「消息条数」，不裁单条内容的行数。
 * 一条 5 万行的工具输出、或一个数 MB 的 diff，会在 <markdown> / <diff> 内部
 * 按行创建 opentui 原生 text_buffer，单独即可撞上 65,535 句柄表上限，表现为
 * 「打开会话即退出」。本模块给出统一的折叠口径，各渲染点按需调用。
 *
 * 与 collapse-tool-output.ts 的分工：后者折叠**工具输出预览**（短、可展开），
 * 本模块兜底**渲染进 opentui 的全文**（长、不可展开）。两者都需保留。
 */

/** 单条内容默认行数上限：约覆盖正常对话，超出部分折叠。 */
export const DEFAULT_MAX_CONTENT_LINES = 2000

/** 单条内容默认字节上限 512KB：超过则按码点截断（防止超长单行）。 */
export const DEFAULT_MAX_CONTENT_BYTES = 512 * 1024

/** 折叠标记：告知用户内容被截断，避免「静默丢数据」的误解。 */
export const TRUNCATION_MARKER = "…"

/**
 * 按行数上限折叠：超限时保留前 maxLines 行并追加标记。
 *
 * maxLines ≤ 0 视为「不折叠」（防御非法配置，直接放行）。
 */
export function limitContentLines(text: string, maxLines: number = DEFAULT_MAX_CONTENT_LINES): string {
  const limit = Math.floor(maxLines)
  if (limit <= 0) return text
  if (text.length === 0) return text

  let start = 0
  let lines = 0
  while (start <= text.length) {
    const end = text.indexOf("\n", start)
    if (end === -1) {
      // 最后一行
      lines += 1
      break
    }
    lines += 1
    start = end + 1
    if (lines > limit) {
      // 已确认超出上限：切到第 limit 行（1 基线）的行尾
      const boundary = lineEndAt(text, limit)
      return text.slice(0, boundary) + "\n" + TRUNCATION_MARKER
    }
  }
  return text
}

/** 返回第 n 行（1 基线）行尾的字符索引；不存在时返回 text.length。 */
function lineEndAt(text: string, n: number): number {
  let start = 0
  for (let i = 1; i < n; i++) {
    const end = text.indexOf("\n", start)
    if (end === -1) return text.length
    start = end + 1
  }
  const end = text.indexOf("\n", start)
  return end === -1 ? text.length : end
}

export interface LimitContentOptions {
  /** 行数上限；≤0 关闭行折叠。 */
  maxLines?: number
  /** 字节上限（UTF-8）；≤0 关闭字节折叠。 */
  maxBytes?: number
}

export interface LimitedContent {
  /** 可直接交给渲染器的内容（已折叠/截断）。 */
  text: string
  /** 是否发生了折叠或截断。 */
  truncated: boolean
  /** 被折叠掉的行数（字节截断导致的行数无法精确统计，记为 0）。 */
  hiddenLines: number
}

/**
 * 先按行折叠，再按字节截断。
 *
 * 顺序理由：行折叠对用户可读（保留结构），字节截断是最后兜底（防止超长单行）。
 * 截断按码点边界推进，保证不切碎多字节字符与代理对。
 */
export function limitContent(
  text: string,
  options: LimitContentOptions = {},
): LimitedContent {
  const maxLines = options.maxLines ?? DEFAULT_MAX_CONTENT_LINES
  const maxBytes = options.maxBytes ?? DEFAULT_MAX_CONTENT_BYTES

  const totalLines = text.length === 0 ? 0 : countLines(text)
  const lineFolded = totalLines > Math.max(0, Math.floor(maxLines)) && maxLines > 0
  const folded = lineFolded ? limitContentLines(text, maxLines) : text

  if (maxBytes <= 0 || Buffer.byteLength(folded, "utf8") <= maxBytes) {
    return {
      text: folded,
      truncated: lineFolded,
      hiddenLines: lineFolded ? totalLines - Math.floor(maxLines) : 0,
    }
  }

  // 字节兜底：为折叠标记预留空间，保证最终结果不超预算
  const markerBytes = Buffer.byteLength(TRUNCATION_MARKER, "utf8")
  const cut = sliceByUtf8Budget(folded, Math.max(0, maxBytes - markerBytes))
  // 回退到最后一个完整行，避免半行结尾
  const lineBreak = cut.lastIndexOf("\n")
  const body = lineBreak > 0 ? cut.slice(0, lineBreak) : cut
  return {
    text: body + TRUNCATION_MARKER,
    truncated: true,
    hiddenLines: Math.max(0, totalLines - countLines(body)),
  }
}

function countLines(text: string): number {
  if (text.length === 0) return 0
  let n = 1
  for (let i = 0; i < text.length; i++) if (text.charCodeAt(i) === 10) n += 1
  return n
}

/** 按 UTF-8 字节预算切字符串，遇字符边界推进，不产生孤立代理项。 */
function sliceByUtf8Budget(text: string, budget: number): string {
  if (budget <= 0) return ""
  let bytes = 0
  let i = 0
  while (i < text.length) {
    const code = text.codePointAt(i)!
    const size = code > 0xffff ? 4 : code > 0x7ff ? 3 : code > 0x7f ? 2 : 1
    if (bytes + size > budget) break
    bytes += size
    i += code > 0xffff ? 2 : 1
  }
  return text.slice(0, i)
}
