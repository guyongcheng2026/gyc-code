// 品牌禁用词单一来源（铁律 1 / 铁律 2）。
//
// 此前 brand-guard / verify-tui / verify-cli / verify-web 各自维护一份词表，
// 内容互不一致（verify-web 缺 hermes，全部缺 pi agent），导致 2026-09-30 复审时
// 62 处「pi agent」残留无人拦截。现统一由本文件导出。
//
// 分两级：
//   BANNED_BRAND_WORDS —— 他牌产品名，自有文案中一律不得出现（铁律 1）。
//   PROVIDER_TOKENS    —— 第三方模型/供应商 ID，属合理技术引用（铁律 2）。
//                          是否放行由各守卫的豁免名单按上下文判定，不在词表层放宽。

/** 他牌产品名：自有文案（界面、技能说明、用户可见文档）中禁止出现。 */
export const BANNED_BRAND_WORDS = [
  "hermes",
  "claude",
  "claude code",
  "claude-code",
  "codex",
  "codex cli",
  "mimo",
  "mimo code",
  "mimo-code",
  "pi agent",
  "opencode",
  "chatgpt",
  "copilot",
  "windsurf",
  "gemini",
]

/**
 * 第三方供应商 ID：实践中几乎总出现在 provider 配置、SDK 包名、协议常量里。
 * 历史 verify 脚本已把它们纳入扫描并按文件级豁免放行，故在此一并导出供复用——
 * 统一词源时若漏掉这些词，会让 verify-* 的检查强度静默退化。
 */
export const SUPPLIER_ID_TOKENS = ["anthropic", "openai"]

/** 合规扫描全量词表：产品名 + 供应商 ID（verify-* 脚本使用）。 */
export const COMPLIANCE_FORBIDDEN = [...new Set([...BANNED_BRAND_WORDS, ...SUPPLIER_ID_TOKENS])]

/**
 * 第三方供应商 / 模型 ID 子串：命中且同处一行出现这些信号时，视为铁律 2 合理引用。
 * 用于把「自有文案违规」与「协议标识符 / 模型 ID」区分开，避免守卫误伤导致被绕过。
 */
const EXEMPT_CONTEXT_SPANS = [
  /https?:\/\/\S+/gi, // 第三方端点
  /@[a-z0-9-]+\/\S*/gi, // 第三方包名，如 @opencode-ai/plugin
  /\bmodels\.\S*/gi, // models.dev / models.opencode.ai 等模型清单服务
  /\bprocess\.env\.\S+|\benv\.\S+/g, // 环境变量名，如 HERMES_HOME / CODEX_CI
  /\bv?\d+\.\d+(?:\.\d+)?\b/g, // 第三方版本号（v0.20.5 等）
  /协议|标识符|互操作|端点|上游|沿革|逆向|实证/g, // 注释中说明引用来源
]

/**
 * 剥掉属于「铁律 2 合理引用」的片段，只留自有文案部分供查禁用词。
 *
 * 此前是「同行出现任一信号就整行放行」，等于给守卫留了一条只需在违规行末尾
 * 补一个链接即可绕过的通路——守卫一旦能被这么绕过，白名单之外的检查形同虚设。
 * 改成先切除合理引用片段、再在剩余文案里查词，误伤面不增，绕过面消失。
 */
export function stripExemptContext(line) {
  return EXEMPT_CONTEXT_SPANS.reduce((acc, re) => acc.replace(re, " "), line)
}

/**
 * 该行是否命中禁用品牌词。
 * @returns {string|null} 命中的词；未命中返回 null。
 */
export function findBannedWord(line, words = BANNED_BRAND_WORDS) {
  const lower = line.toLowerCase()
  for (const w of words) {
    if (lower.includes(w)) return w
  }
  return null
}
