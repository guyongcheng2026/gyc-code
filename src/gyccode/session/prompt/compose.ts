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
 * 换行符：LF（"\n"）。
 *
 * 实测依据（2026-10-11）：用 `git cat-file blob <rev>:<path>` 取 Buffer 逐字节核对
 * （不经 shell 管道，避免被改写），仓库 prompt 变体文件**历来就是 LF** —— 抽取前的
 * b8d5248b2c^ 版本 default.txt 已是 70 个裸 LF、0 个 CRLF；`git ls-files --eol` 对
 * 该目录全部 29 个文件均报 i/lf w/lf。Bun 的 .txt 导入器逐字节保留原文、不做归一化
 * （importedString.length === fileBytes）。
 *
 * 教训：本模块最初把「必须是 CRLF」当成实测结论写进注释，于是 composeVariant 产出
 * 「LF 内容 + CRLF 分隔」的混合行尾，11 个基线测试长期失败。当时若反向地改文件去
 * 迁就 CRLF，会让整篇 prompt 文本位移、摧毁 prompt cache 前缀 —— 代价远大于修正
 * 这一行。事实核对要落到字节，不能落在注释上。
 *
 * 与 llm/request.ts 的 assembleSystemPrompt（join("\n")）方向一致：两者都是 LF，
 * 因此这里的拼接不会引入额外差异。
 */
const EOL = "\n"

/**
 * 公共段正文（去掉 _core.txt 结尾那一个换行）。
 *
 * 去尾换行是为了让拼接完全由下面的 parts 控制，不会因为「公共段恰好带尾换行」
 * 而多出一个空行。段内换行原样保留。
 */
function coreBody(): string {
  return SHARED_CORE.replace(/\n$/, "")
}

/**
 * 把一个变体文件渲染成最终送进 LLM 的文本。
 *
 * 拼接顺序显式约定为 [HEAD, CORE, TAIL]，CORE 原位替换标记行：
 *   - 变体文件 = HEAD + EOL + CORE_MARKER + EOL + TAIL
 *   - 渲染结果 = HEAD + EOL + CORE + EOL + TAIL
 * HEAD 为空（公共段在文件最开头，如 beast/gpt/trinity）或 TAIL 为空时，
 * 对应的分隔符一并省掉，不凭空插入换行。
 *
 * 变体文件不含标记时原样返回 —— reminder 类变体（build-switch/compose/plan/
 * plan-mode）本就不含公共段，不参与抽取，字节必须完全不动。
 */
export function composeVariant(variant: string): string {
  const at = variant.indexOf(CORE_MARKER)
  if (at === -1) return variant

  // 标记独占一行：其前要么是文件开头、要么以换行结尾；其后同理。
  const head = variant.slice(0, at).replace(/\n$/, "")
  const tail = variant.slice(at + CORE_MARKER.length).replace(/^\n/, "")

  const parts: string[] = []
  if (head !== "") parts.push(head)
  parts.push(...coreBody().split(EOL))
  if (tail !== "") parts.push(tail)
  return parts.join(EOL)
}

/** 公共段正文，导出供测试断言「变体里已不再重复公共段」。 */
export const SHARED_CORE_BODY = coreBody()