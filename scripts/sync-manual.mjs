// scripts/sync-manual.mjs - 操作手册同步校验（bound to .githooks/post-commit）
//
// 目的：命令行命令、内置工具、快捷键、配置项、权限规则属"对外可见的功能面"。
// 这些面发生变化时，docs/gyccode操作手册.docx 就可能过时。本脚本在每次提交后
// 检测本次提交是否触及功能面；若触及且手册未随之重新生成，则提示使用者并写日志。
//
// 判定方式：比较"功能面文件的最近改动提交"与"手册正文的最近改动提交"。
// 取较晚者，若手册落后则判定为待同步。全部操作 fail-soft，绝不阻塞提交。
import { execFileSync } from "node:child_process"
import fs from "node:fs"
import path from "node:path"

const REPO = process.cwd()
const LOGFILE = path.join(REPO, ".git", "manual-sync.log")
const MANUAL = "docs/gyccode操作手册.docx"
// 手册正文与排版源：这些文件变了才算"手册已更新"。
// 实际路径在 main() 中按前缀于磁盘枚举，此处仅保留说明，新增章节无需改动本文件。
const MANUAL_SOURCES_DOC = [
  "scripts/gen_manual_docx.py",
  "scripts/manual_docx_style.py",
  "scripts/manual_content_1.py ... _N.py",
  MANUAL,
]
// 功能面：改动任一文件都可能使手册内容过时
const FEATURE_SURFACE = [
  "src/cli/cmd/",           // 命令行命令与选项
  "src/gyccode/command-registry.ts",
  "src/gyccode/tool/",      // 内置工具与启用规则
  "src/tui/config/",        // 快捷键与界面配置
  "src/gyccode/config/",    // 配置 schema
  "src/gyccode/permission/", // 权限规则
  "src/core/v1/config/",    // 配置字段定义
  "src/gyccode/agent/",     // 智能体
  "src/gyccode/skill/",     // 技能
  "src/gyccode/mcp/",       // 外部协议服务器
]

const glog = (m) => {
  try {
    fs.appendFileSync(LOGFILE, `[${new Date().toISOString()}] ${m}\n`, "utf8")
  } catch {}
}

function git(...args) {
  return execFileSync("git", args, {
    cwd: REPO,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "ignore"],
  }).trim()
}

function lastCommitTouching(paths) {
  // 取一次提交里触及任一路径的最新提交时间戳；无则返回空串
  try {
    return git("log", "-1", "--format=%ct", "--", ...paths)
  } catch {
    return ""
  }
}

function hasManualChangedSince(featureTs, manualTs) {
  if (!featureTs) return false
  if (!manualTs) return true // 手册从未提交过，视为待同步
  return Number(manualTs) < Number(featureTs)
}

// 手册源文件会随章节增加而增多（如 manual_content_7.py），故按前缀在磁盘上
// 枚举，避免每新增一章就要改本脚本而漏监控。
function manualSourcePaths() {
  const dir = path.join(REPO, "scripts")
  let names = []
  try {
    names = fs.readdirSync(dir).filter(
      (n) => /^manual_content_\d+\.py$/.test(n) || n === "gen_manual_docx.py" || n === "manual_docx_style.py",
    )
  } catch {}
  return names.map((n) => "scripts/" + n).concat([MANUAL])
}

function main() {
  if (!fs.existsSync(path.join(REPO, ".git"))) return

  const sources = manualSourcePaths()
  const featureTs = lastCommitTouching(FEATURE_SURFACE)
  const manualTs = lastCommitTouching(sources)
  if (!hasManualChangedSince(featureTs, manualTs)) return

  const featureAt = featureTs ? new Date(Number(featureTs) * 1000).toISOString() : "?"
  const manualAt = manualTs ? new Date(Number(manualTs) * 1000).toISOString() : "未提交"
  const msg =
    "操作手册待同步：功能面文件在 " + featureAt +
    " 有改动，而手册正文最近同步于 " + manualAt +
    "。请更新 scripts/manual_content_*.py 后执行 python scripts/gen_manual_docx.py"
  glog(msg)
  console.log("[manual] " + msg)
}

main()
