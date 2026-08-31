// GBK 双重编码乱码检测（P0-1 复发防线）
// 用法:
//   bun scripts/check-mojibake.mjs <file...>   检查指定文件
//   bun scripts/check-mojibake.mjs --staged    检查 git 暂存区文件（pre-commit 用）
//   bun scripts/check-mojibake.mjs             检查整个 src
// 检出任意乱码行时以退出码 1 失败，错误信息列出 文件:行号。
import iconv from "iconv-lite"
import { readFileSync, readdirSync, statSync } from "fs"
import { join, extname } from "path"
import { execSync } from "child_process"

// GBK 双重编码乱码特征:
// 1) Unicode 私有区（GBK→Unicode 映射的 PUA 残留）——正常简体中文注释绝不含
// 2) GBK 反向解码后产出"可读中文"：全角标点/全角形式，或 3+ 连续汉字。
//    关键区分：正常中文行做同样解码会退化为希腊/拉丁扩展字符（GBK 高字节
//    B0-DF 与 UTF-8 双字节序列重叠），绝不会出现全角区或连续汉字。
const PUA_RE = /[\uE000-\uF8FF]/
const FULLWIDTH_RE = /[\u3000-\u303F\uFF01-\uFFEE]/ // CJK 标点 + 全角形式
const CJK_RUN_RE = /[\u3400-\u4DBF\u4E00-\u9FFF]{3,}/
const CHECK_EXTS = new Set([".ts", ".tsx", ".md", ".json", ".mjs", ".cjs"])
const SKIP_DIRS = new Set(["node_modules", "dist", "gen", ".gen", "generated"])
const SKIP_FILES = new Set(["bundle.gen.ts"]) // gen 产物按约定排除

function isMojibakeLine(line) {
  if (PUA_RE.test(line)) return true
  const clean = line.replace(/[\uFEFF\u200B-\u200D\u2060]/g, "") // 剔除 BOM/零宽字符（iconv 会替换它们造成假差异）
  if (!/[^\x00-\x7F]/.test(clean)) return false
  try {
    const back = Buffer.from(iconv.encode(clean, "gbk")).toString("utf-8")
    if (back === clean) return false
    // 强指纹优先：反向解码产出可读中文（全角形式或 3+ 连续汉字）→ 双重编码实锤。
    // 注意此判断必须在 FFFD 否决之前——部分乱码字符的 GBK 反向映射有损，
    // back 会同时含连续汉字与 FFFD（如"跳过空\ufffd和注\ufffd?"）。
    if (FULLWIDTH_RE.test(back) || CJK_RUN_RE.test(back)) return true
    if (/[\uFFFD\uE000-\uF8FF]/.test(back)) return false // 仅替换符：不可靠，不算
    return false
  } catch {
    return false
  }
}

function checkFile(path) {
  const hits = []
  let text
  try {
    text = readFileSync(path, "utf-8")
  } catch {
    return hits // 读不了的文件（二进制等）跳过
  }
  const lines = text.split("\n")
  for (let i = 0; i < lines.length; i++) {
    if (isMojibakeLine(lines[i])) hits.push(`${path}:${i + 1}`)
  }
  return hits
}

function walk(dir, acc = []) {
  for (const ent of readdirSync(dir, { withFileTypes: true })) {
    if (ent.name.startsWith(".")) continue
    const p = join(dir, ent.name)
    if (ent.isDirectory()) {
      if (SKIP_DIRS.has(ent.name)) continue
      walk(p, acc)
    } else if (CHECK_EXTS.has(extname(ent.name)) && !SKIP_FILES.has(ent.name)) {
      acc.push(p)
    }
  }
  return acc
}

let files
const args = process.argv.slice(2)
if (args.includes("--staged")) {
  const out = execSync("git diff --cached --name-only -z", { encoding: "utf-8", maxBuffer: 16 * 1024 * 1024 })
  files = out.split("\0").filter((f) => f && CHECK_EXTS.has(extname(f)))
} else if (args.length) {
  files = args.filter((f) => {
    try {
      return statSync(f).isFile()
    } catch {
      return false
    }
  })
} else {
  files = walk("src")
}

const hits = files.flatMap(checkFile)
if (hits.length) {
  console.error(`\n[check-mojibake] 检出 GBK 双重编码乱码 ${hits.length} 行（禁止提交）：`)
  for (const h of hits) console.error(`  ${h}`)
  console.error(`\n修复方式：git checkout -- <file> 恢复，或参照 docs/WORKLOG-2026-08-31.md 的恢复流程。`)
  process.exit(1)
}
console.log(`[check-mojibake] ${files.length} 个文件检查通过`)