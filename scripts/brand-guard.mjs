#!/usr/bin/env node
// 品牌合规守卫（铁律 1）
//
// 目标：自有产品的**代码标识符、CLI 文案、文档叙述**中禁止出现其他 AI 产品品牌词，
// 防止他牌品牌以任何形式被展示为自有产品能力。
//
// 明确放行（属合理引用，不是品牌展示）：
//   1. 第三方 API 端点与协议标识符
//      例：https://models.opencode.ai（上游模型清单服务）、@opencode-ai/plugin（插件包名）。
//   2. 第三方模型 / 供应商 ID
//      例：nousresearch/hermes-3-llama-3.1-70b、OpenCode Zen（第三方计费服务名）。
//   3. 迁移探测与互操作代码
//      例：src/core/global/gyc-home.ts 的 legacyHome()、cli/cmd/gateway.ts 的
//          detectHermesGateway()——需按历史名读写第三方状态，属互操作。
//   4. 回归测试与解释沿革的设计决策注释（断言的正是"不采纳该品牌变量"）。
//
// 因此本守卫只在**自有文案高危区**生效：gyc-cli 的用户可见界面模块 + skills 目录。
// 其余位置靠 review 保证，不做正则误伤。
import { readdirSync, readFileSync, statSync } from "node:fs"
import { extname, join, relative } from "node:path"
import { BANNED_BRAND_WORDS, findBannedWord, isExemptLine } from "./brand-words.mjs"

const ROOT = process.argv[2] ?? "."
const BANNED = BANNED_BRAND_WORDS

// 自有文案高危区：直接面向用户的界面层 + 用户可查阅的技能说明，违规会实际展示给用户。
// src/cli 是 gyc-cli 的 TUI 前端（展示文案 + 设计决策注释都在这里）。
// src/gyccode/skills 是内置技能包：用户通过 /skill 查阅其 agent.md / agent.json，
// 属自有文案，历史上因未纳入本守卫而残留 62 处「pi agent」指代自有产品的表述。
const GUARDED_ROOTS = ["src/cli", "src/gyccode/skills", "skills"]

// 精确白名单：整文件放行，理由必须写清。
const ALLOWED_FILES = {
  // 互操作探测：需按第三方协议的固定目录名读取其状态文件，防止抢占同一 bot 连接。
  // 目录名是协议标识符不可改写；展示文案与代码标识符已改用自有命名。
  "src/cli/cmd/gateway.ts": "互操作状态文件路径，协议标识符不可改",
}

// 行级精确白名单：第三方供应商 ID / 计费套餐名 / 模型 ID（铁律 2 合理引用）。
// 逐条登记而非用通用信号盲放——通用信号会让守卫整体失守，正是本次要根除的问题。
// key 为 `相对路径::行内容子串`，**不用行号**：行号会随任意代码插入而漂移，
// 实测在白名单行前插入 1 行即导致误报，守卫一旦误报就会被维护者整体关闭。
const ALLOWED_LINES = {
  "src/cli/cmd/github.handler.ts::add guide for copilot":
    "TODO 注释：待补 github-copilot 供应商指引，为第三方 provider key",
  'src/cli/cmd/github.handler.ts::delete p["github-copilot"]':
    "第三方 provider key 删除逻辑，非品牌展示",
  'src/cli/cmd/providers.ts::"github-copilot": 2': "第三方供应商排序权重表的 key",
  "src/cli/cmd/providers.ts::ChatGPT Plus/Pro": "第三方 OpenAI 计费套餐名，非自有品牌冒用",
  "src/gyccode/skills/network-tools/agent.md::claude-3-5-sonnet": "MCP 调用示例中的第三方模型 ID（铁律 2）",
}

const SKIP_DIRS = new Set(["node_modules", "dist", ".git", "docs", "models-mirror", "marketplace", ".claude"])
const SCAN_EXT = new Set([".ts", ".tsx", ".mjs", ".cjs", ".js", ".json", ".md"])

const violations = []

/** 行内容是否命中行级白名单（内容锚定，抗行号漂移）。 */
function isAllowedLine(rel, line) {
  for (const [key] of Object.entries(ALLOWED_LINES)) {
    const sep = key.indexOf("::")
    if (key.slice(0, sep) !== rel) continue
    if (line.includes(key.slice(sep + 2))) return true
  }
  return false
}

function scan(file) {
  const rel = relative(ROOT, file).replace(/\\/g, "/")
  if (rel in ALLOWED_FILES) return
  if (rel.endsWith(".test.ts") || rel.endsWith(".test.tsx") || rel.endsWith(".spec.ts")) return
  const lines = readFileSync(file, "utf8").split("\n")
  lines.forEach((line, i) => {
    if (isAllowedLine(rel, line)) return
    // 按行豁免：第三方端点 / 包名 / 模型 ID / 环境变量名属铁律 2 合理引用。
    // 守卫词表已收敛为产品名，若不做行级豁免会把协议互操作代码误判为违规，
    // 进而在后续维护中被整体关闭——这正是 2026-09-30 之前 62 处残留无人拦截的成因。
    if (isExemptLine(line)) return
    const word = findBannedWord(line, BANNED)
    if (word) violations.push(`${rel}:${i + 1} 命中禁用品牌词 "${word}"`)
  })
}

function walk(dir) {
  let entries
  try {
    entries = readdirSync(dir)
  } catch {
    return
  }
  for (const entry of entries) {
    if (SKIP_DIRS.has(entry)) continue
    const full = join(dir, entry)
    let st
    try {
      st = statSync(full)
    } catch {
      continue
    }
    if (st.isDirectory()) walk(full)
    else if (SCAN_EXT.has(extname(full))) scan(full)
  }
}

for (const dir of GUARDED_ROOTS) walk(join(ROOT, dir))
walk(join(ROOT, "skills"))

if (violations.length > 0) {
  console.error("[brand-guard] 自有文案区品牌合规违规：")
  for (const v of violations) console.error("  " + v)
  console.error(
    `\n共 ${violations.length} 处。改用自有品牌名（gyc-code / gyc / @gyccode）；` +
      `如属第三方端点/包名/模型 ID 等合理引用，请移出 GUARDED_ROOTS 或加入本文件放行说明。`,
  )
  process.exit(1)
}
console.log("[brand-guard] 通过：自有文案区未发现禁用品牌词")
