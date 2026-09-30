// 工作区残留文件扫描（极简主义 · 铁律 7 兜底）。
//
// 为什么要它：.gitignore 已忽略 *.bak / *.bak2 / *.orig / *.rej / *~ 等，
// 这类文件**不会被 git 察觉**，一旦在目录里堆积就成了无人知晓的垃圾。
// 历史上 skills/marketplace/index.json.bak / .bak2 就这样潜伏过（2026-08-26 清理）。
//
// 用法：node scripts/check-workspace-junk.mjs [根目录]
// 命中时输出清单并以退出码 1 阻断 pre-commit。
import { readdirSync, statSync, existsSync } from "node:fs"
import { join, relative } from "node:path"

// 残留后缀：备份、补丁残留、编辑器临时文件
const JUNK_SUFFIX = [".bak", ".bak2", ".orig", ".rej", ".old", ".swp", ".swo", "~", ".tmp"]

// 不扫描的目录：依赖、构建产物、VCS 元数据、模型镜像
const SKIP_DIRS = new Set([
  "node_modules",
  "dist",
  ".git",
  "models-mirror",
  ".mimocode",
  ".cache",
  "coverage",
  "vendor",
])

const ROOT = process.argv[2] ?? "."
const found = []

function walk(dir) {
  let entries
  try {
    entries = readdirSync(dir)
  } catch {
    return
  }
  for (const name of entries) {
    if (SKIP_DIRS.has(name)) continue
    const full = join(dir, name)
    let st
    try {
      st = statSync(full)
    } catch {
      continue
    }
    if (st.isDirectory()) {
      walk(full)
      continue
    }
    const lower = name.toLowerCase()
    if (JUNK_SUFFIX.some((s) => lower.endsWith(s))) {
      found.push(relative(ROOT, full).replace(/\\/g, "/"))
    }
  }
}

if (!existsSync(ROOT)) {
  console.error(`[workspace-junk] 根目录不存在: ${ROOT}`)
  process.exit(1)
}
walk(ROOT)

if (found.length > 0) {
  console.error("[workspace-junk] 工作区存在备份/临时残留文件（铁律 7：目录不得有多余文件）：")
  for (const f of found) console.error(`  ${f}`)
  console.error(`\n共 ${found.length} 个。确认无用后删除；.gitignore 忽略了它们，git 不会提醒。`)
  process.exit(1)
}
console.log("[workspace-junk] 通过：工作区无备份/临时残留文件")
