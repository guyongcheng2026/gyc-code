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

const ROOT = process.argv[2] ?? "."
const BANNED = ["hermes", "claude code", "claude-code", "codex cli", "mimo code", "mimo-code", "pi agent", "opencode"]

// 自有文案高危区：直接面向用户的界面层，违规会实际展示给用户。
// src/cli 是 gyc-cli 的 TUI 前端（展示文案 + 设计决策注释都在这里）。
const GUARDED_ROOTS = ["src/cli", "skills"]

// 精确白名单：整文件放行，理由必须写清。
const ALLOWED_FILES = {
  // 互操作探测：需按第三方协议的固定目录名读取其状态文件，防止抢占同一 bot 连接。
  // 目录名是协议标识符不可改写；展示文案与代码标识符已改用自有命名。
  "src/cli/cmd/gateway.ts": "互操作状态文件路径，协议标识符不可改",
}

const SKIP_DIRS = new Set(["node_modules", "dist", ".git", "docs", "models-mirror", "marketplace", ".claude"])
const SCAN_EXT = new Set([".ts", ".tsx", ".mjs", ".cjs", ".js", ".json", ".md"])

const violations = []

function scan(file) {
  const rel = relative(ROOT, file).replace(/\\/g, "/")
  if (rel in ALLOWED_FILES) return
  if (rel.endsWith(".test.ts") || rel.endsWith(".test.tsx") || rel.endsWith(".spec.ts")) return
  const lines = readFileSync(file, "utf8").split("\n")
  lines.forEach((line, i) => {
    const lower = line.toLowerCase()
    for (const word of BANNED) {
      if (lower.includes(word)) {
        violations.push(`${rel}:${i + 1} 命中禁用品牌词 "${word}"`)
        return
      }
    }
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
