// gyc 家目录的唯一权威解析（core 包）。
// 品牌铁律：自有产品名只认 gyc-code / gyc / @gyccode。
//
// 历史包袱：早期代码曾回退到 HERMES_HOME（第三方 Agent 生态变量），导致
//   1) 自有产品文案出现他牌品牌词，违反品牌合规铁律；
//   2) 同一三元式在 6 个文件各复制一份，改一处漏两处，路径行为易发散。
//
// 现在统一走本函数：GYCCODE_MEMORY_HOME 显式覆盖 > ~/.gyc 默认。
// 旧数据若已落在该变量根下，由 legacyMemoryHome() 单独处理（只读迁移探测），
// 不再参与默认路径解析。
import { homedir } from "node:os"
import { join } from "node:path"

/** 家目录：$GYCCODE_MEMORY_HOME，或 ~/.gyc。 */
export function gycHome(): string {
  const override = process.env.GYCCODE_MEMORY_HOME
  if (override !== undefined && override.length > 0) return override
  return join(homedir(), ".gyc")
}

/**
 * 旧版（移除品牌回退前）可能使用过的家目录，仅用于一次性数据迁移探测。
 *
 * 必须在历史值上查找——这里是全仓唯一允许出现该字符串的位置，
 * 且不得作为任何读写的默认路径，只作为「老数据在哪」的线索。
 */
export function legacyHome(): string | undefined {
  const legacy = process.env.HERMES_HOME
  if (legacy !== undefined && legacy.length > 0) return legacy
  return undefined
}
