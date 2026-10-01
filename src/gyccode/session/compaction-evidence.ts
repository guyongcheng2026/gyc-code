/**
 * 压缩/微压缩的「证据密度」保护清单（幻觉率 P1 / H-05）。
 *
 * 背景：压缩侧原本只保护 `skill`，把 read/grep/glob/bash 的输出与 edit/write
 * 同等对待地清掉。但 read/grep/glob 的输出是**事实证据**（代码的真实内容），
 * 清掉之后模型只能凭记忆复述，幻觉率直接上升；edit/write 只是**变更**，
 * 可以从 git diff / 文件现状重建，清掉几乎无损。
 *
 * 取舍原则（按「不可从其它途径重建」排序）：
 * 1. `skill`：输出是模型仍需遵守的指令文本，既不可重建又直接决定后续行为，
 *    无条件保护。
 * 2. `read` / `grep` / `glob`：代码、匹配行、文件清单等客观事实。文件随时可能
 *    被谷总改过，重读拿到的未必是同一份内容，故在**输出体量可控**时整份保护。
 * 3. `bash`：输出是客观事实，但同一条命令可以重跑复现，属于「可重建证据」，
 *    因此只保护短输出（结论、报错这类高价值片段），长输出仍可被压缩。
 * 4. `edit` / `write` / `patch` 等写类工具：输出只是变更回执，git 可恢复，
 *    不保护。
 *
 * 为什么不是无脑全保：保护是无条件的就会让压缩彻底失效（越保护的越多、
 * 越压越涨）。所以对证据类工具加了长度闸门——超过 `EVIDENCE_KEEP_CHARS`
 * 的证据输出走「头 + 尾」截断保护（见 `keepsTailOnTruncate`），既保住
 * read 的文件头与末尾的完整性标记（`Showing lines X-Y of N`）、
 * grep 的末尾匹配行、bash 的末尾报错，又不让超长输出把压缩预算吃光。
 */

/** 无条件保护：不可重建且直接决定后续行为。 */
export const ALWAYS_PROTECTED_TOOLS: ReadonlySet<string> = new Set(["skill"])

/** 不可重建的事实证据：短输出整份保护，长输出走头尾截断。 */
export const EVIDENCE_TOOLS: ReadonlySet<string> = new Set(["read", "grep", "glob"])

/** 可重建的事实证据（重跑命令即可复现）：只保护短输出。 */
export const REPRODUCIBLE_EVIDENCE_TOOLS: ReadonlySet<string> = new Set(["bash"])

/** 证据类输出的「整份保护」长度上限（字符）。超过则不再全保，改走截断保护。 */
export const EVIDENCE_KEEP_CHARS = 4_000

/** 截断保护时额外保留的尾部字符数。 */
export const TOOL_OUTPUT_TAIL_CHARS = 500

/** 取工具输出的长度；非字符串（异常态）按 0 处理，视为空输出因而可压缩。 */
export function outputLengthOf(output: unknown): number {
  return typeof output === "string" ? output.length : 0
}

/**
 * 压缩/微压缩是否应当跳过该 part（保护其输出不被清空）。
 *
 * @param tool 工具 ID（bash / read / grep / …）
 * @param outputLength 该 part 已完成输出的字符数，缺省视为 0
 */
export function isProtectedToolOutput(tool: string, outputLength: number = 0): boolean {
  if (ALWAYS_PROTECTED_TOOLS.has(tool)) return true
  if (EVIDENCE_TOOLS.has(tool) || REPRODUCIBLE_EVIDENCE_TOOLS.has(tool)) {
    return outputLength <= EVIDENCE_KEEP_CHARS
  }
  return false
}

/** 该工具的输出被截断时，是否需要额外保留尾部（read 的完整性标记在末尾）。 */
export function keepsTailOnTruncate(tool: string | undefined): boolean {
  if (tool === undefined) return false
  return EVIDENCE_TOOLS.has(tool) || REPRODUCIBLE_EVIDENCE_TOOLS.has(tool)
}
