/**
 * 工具输出预览折叠（长会话内存的隐形放大器）。
 *
 * 旧实现对**完整** output 执行 `Array.from(output).length` 来判断是否超限：
 * 32MB 输出实测产生约 38MB 堆增量（数千万元素数组），而本函数被包在
 * createMemo 中（routes/session/index.tsx 的工具输出渲染），流式期间会对
 * 同一 output 反复触发，内存随之持续抖动。
 *
 * 新策略：先按行切片，只对**已切片的前缀**做码点计数；ASCII 快速通道用
 * str.length 直接判定，仅在可能超限或含非 ASCII 时才走码点迭代。
 */

/** 结果：折叠后的输出与是否发生溢出。 */
export interface CollapsedToolOutput {
  output: string
  overflow: boolean
}

/** 判断字符串是否全为单码元 ASCII（可跳过码点迭代）。 */
function isAscii(text: string): boolean {
  for (let i = 0; i < text.length; i++) if (text.charCodeAt(i) > 0x7f) return false
  return true
}

/**
 * 计算码点数，但只在需要时物化：
 * - 纯 ASCII：码点数 === str.length，零分配
 * - 含非 ASCII：按码点迭代计数，仍不产生数组
 */
function codePointLength(text: string): number {
  if (isAscii(text)) return text.length
  let n = 0
  for (let i = 0; i < text.length; ) {
    const code = text.codePointAt(i)!
    n += 1
    i += code > 0xffff ? 2 : 1
  }
  return n
}

/** 按码点预算截断（不切碎多字节字符与代理对）。 */
function sliceByCodePoints(text: string, limit: number): string {
  if (isAscii(text)) return text.slice(0, limit)
  let n = 0
  let i = 0
  while (i < text.length && n < limit) {
    const code = text.codePointAt(i)!
    i += code > 0xffff ? 2 : 1
    n += 1
  }
  return text.slice(0, i)
}

/**
 * 按 maxChars（码点）截断并追加省略标记。
 * limit ≤ 0 时返回空串，保证最终长度不超过 maxChars。
 */
function clipChars(text: string, maxChars: number): string {
  if (maxChars <= 0) return "…"
  if (codePointLength(text) <= maxChars) return text
  // 预留 1 个码元给省略标记
  return sliceByCodePoints(text, maxChars - 1) + "…"
}

export function collapseToolOutput(output: string, maxLines: number, maxChars: number): CollapsedToolOutput {
  // 先做快速判定：输出整体很短且行数不多时直接返回，避免无谓切分。
  // 注意先判字节：output.length ≤ maxChars ⟹ 码点数 ≤ maxChars（码点数 ≤ 码元数）。
  if (output.length <= maxChars && lineCountWithin(output, maxLines)) {
    return { output, overflow: false }
  }

  const preview = lineSlice(output, maxLines).join("\n")
  if (codePointLength(preview) > maxChars) {
    return { output: clipChars(preview, maxChars), overflow: true }
  }

  return { output: [...lineSlice(output, maxLines), "…"].join("\n"), overflow: true }
}

/** 行数是否在上限内（不物化数组：只数换行符）。 */
function lineCountWithin(text: string, maxLines: number): boolean {
  if (text.length === 0) return true
  let lines = 1
  for (let i = 0; i < text.length; i++) {
    if (text.charCodeAt(i) === 10) {
      lines += 1
      if (lines > maxLines) return false
    }
  }
  return true
}

/** 取前 maxLines 行；不物化超限部分。 */
function lineSlice(text: string, maxLines: number): string[] {
  const limit = Math.max(0, Math.floor(maxLines))
  const out: string[] = []
  let start = 0
  while (start <= text.length && out.length < limit) {
    const end = text.indexOf("\n", start)
    if (end === -1) {
      out.push(text.slice(start))
      break
    }
    out.push(text.slice(start, end))
    start = end + 1
  }
  return out
}
