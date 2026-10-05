import SHARED_CORE from "./_core.txt"

/**
 * 公共段标记：变体文件里用它占住「原本是 _core.txt 内容」的那几行。
 *
 * 标记行本身不会进入渲染结果 —— composeVariant() 加载时把它原位替换成
 * _core.txt 的真实内容。变体文件里若没有这个标记，composeVariant() 原样返回，
 * 行为与抽取前完全一致（便于逐文件灰度与回滚）。
 */
export const CORE_MARKER = "@@GYCCODE_PROMPT_CORE@@"

/**
 * 换行符：必须是 CRLF，不能用 "\n"。
 *
 * 实测依据：仓库 13 个 prompt 变体文件全部是无 BOM 纯 CRLF；Bun 的 .txt 导入器
 * 逐字节保留文件里的 CRLF，不做归一化（导入后 importedString.length === fileBytes，
 * 且不存在裸 LF）。所以渲染结果要逐字节复现抽取前的样子，段间也只能用 CRLF。
 *
 * 另一个坑：llm/request.ts:110 的 assembleSystemPrompt 用 join("\n") 把数组
 * 拼成一段文本，插进去的是 LF。因此 provider() 必须返回**单元素**数组，由
 * composeVariant 在数组内部用 CRLF 完成拼接；若返回 [head, core, tail] 三元素，
 * 段间分隔符会从 CRLF 退化成 LF，渲染结果立刻与抽取前不一致。
 */
const CRLF = "\r\n"

/**
 * 公共段正文（去掉 _core.txt 结尾那一个 CRLF）。
 *
 * 去尾换行是为了让拼接完全由下面的 parts 控制，不会因为「公共段恰好带尾换行」
 * 而多出一个空行。段内换行原样保留。
 */
function coreBody(): string {
  return SHARED_CORE.replace(/\r\n$/, "")
}

/**
 * 把一个变体文件渲染成最终送进 LLM 的文本。
 *
 * 拼接顺序显式约定为 [HEAD, CORE, TAIL]，CORE 原位替换标记行：
 *   - 变体文件 = HEAD + CRLF + CORE_MARKER + CRLF + TAIL
 *   - 渲染结果 = HEAD + CRLF + CORE + CRLF + TAIL
 * HEAD 为空（公共段在文件最开头，如 beast/gpt/trinity）或 TAIL 为空时，
 * 对应的分隔符一并省掉，不凭空插入换行。
 *
 * 变体文件不含标记时原样返回 —— reminder 类变体（build-switch/compose/plan/
 * plan-mode）本就不含公共段，不参与抽取，字节必须完全不动。
 */
export function composeVariant(variant: string): string {
  const at = variant.indexOf(CORE_MARKER)
  if (at === -1) return variant

  // 标记独占一行：其前要么是文件开头、要么以 CRLF 结尾；其后同理。
  const head = variant.slice(0, at).replace(/\r\n$/, "")
  const tail = variant.slice(at + CORE_MARKER.length).replace(/^\r\n/, "")

  const parts: string[] = []
  if (head !== "") parts.push(head)
  parts.push(...coreBody().split(CRLF))
  if (tail !== "") parts.push(tail)
  return parts.join(CRLF)
}

/** 公共段正文，导出供测试断言「变体里已不再重复公共段」。 */
export const SHARED_CORE_BODY = coreBody()