#!/usr/bin/env node
// 提交前四检的可编程入口（对标指标 18 · 代码审查）
//
// 为什么要抽出来：`.githooks/pre-commit` 里的四项检查此前只能由 git hook 触发。
// 模型用 git_commit 工具提交时，即使 tsc 不过，它自己也毫无感知——只能等
// 人工 review 才发现。把检查搬进这里后，git_commit 可以显式传 run_checks=true
// 在提交前跑一遍，失败就拒绝提交并把失败项结构化回灌给模型。
//
// 四项检查：
//   1. mojibake    —— UTF-8/GBK 双重编码乱码防线（scripts/check-mojibake.mjs）
//   2. brandGuard  —— 自有文案区品牌合规守卫（scripts/brand-guard.mjs）
//   3. bugPatterns —— 空 catch 吞错 / 空壳自递归（scripts/check-bug-patterns.mjs）
//   4. typecheck   —— 全量 tsc --noEmit，仅在暂存区含 src/ 下 TS/TSX 时执行
//
// pre-commit 只剩「取仓库根 → 调本模块 → 按退出码放行」，行为与抽出的逐字等价。
// 三项 node 脚本全部为真实实现，无占位。
import { spawnSync } from "node:child_process"
import { existsSync, realpathSync, mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { basename, join } from "node:path"
import { fileURLToPath } from "node:url"

/** 与 scripts/check-mojibake.mjs 的 CHECK_EXTS 保持一致。 */
export const MOJIBAKE_EXTS = [".ts", ".tsx", ".md", ".json", ".mjs", ".cjs"]

/**
 * 把 git index 里的真实内容物化到临时目录，返回 原路径 -> 临时路径 的映射。
 *
 * 守卫脚本一律 readFileSync(路径)，读的是**工作区**。于是「先 git add、再改工作区」
 * 时，进入提交的是暂存区的旧内容，守卫看到的却是工作区已修好的新内容——违规内容
 * 就能带着一份干净的检查结果合进来。这里把 index 的字节落盘后再交给脚本，
 * 保证「守卫检查的」与「将要提交的」是同一份。
 */
function snapshotIndex(cwd, files) {
  const map = new Map()
  if (files.length === 0) return map
  const dir = mkdtempSync(join(tmpdir(), "gyc-precommit-"))
  // 退出期兜底清理；临时目录删不掉不影响提交正确性，故吞掉异常。
  process.on("exit", () => {
    try {
      rmSync(dir, { recursive: true, force: true })
    } catch {
      // 退出期清理失败无需处理
    }
  })
  files.forEach((rel, i) => {
    const r = spawnSync("git", ["show", `:${rel}`], { cwd, encoding: "buffer", maxBuffer: 64 * 1024 * 1024 })
    if (r.status !== 0 || !r.stdout) return // 二进制或已删除：退回工作区路径
    const dest = join(dir, `${i}-${basename(rel)}`)
    writeFileSync(dest, r.stdout)
    map.set(rel, dest)
  })
  return map
}

/**
 * 把 git index 里的真实内容物化到临时目录，返回 原路径 -> 临时路径 的映射。
 *
 * 守卫脚本一律 readFileSync(路径)，读的是**工作区**。于是「先 git add、再改工作区」
 * 时，进入提交的是暂存区的旧内容，守卫看到的却是工作区已修好的新内容——违规内容
 * 就能带着一份干净的检查结果合进来。这里把 index 的字节落盘后再交给脚本，
 * 保证「守卫检查的」与「将要提交的」是同一份。
 */
function snapshotIndex(cwd, files) {
  const map = new Map()
  if (files.length === 0) return map
  const dir = mkdtempSync(join(tmpdir(), "gyc-precommit-"))
  // 退出期兜底清理；临时目录删不掉不影响提交正确性，故吞掉异常。
  process.on("exit", () => {
    try {
      rmSync(dir, { recursive: true, force: true })
    } catch {
      // 退出期清理失败无需处理
    }
  })
  files.forEach((rel, i) => {
    const r = spawnSync("git", ["show", `:${rel}`], { cwd, encoding: "buffer", maxBuffer: 64 * 1024 * 1024 })
    if (r.status !== 0 || !r.stdout) return // 二进制或已删除：退回工作区路径
    const dest = join(dir, `${i}-${basename(rel)}`)
    writeFileSync(dest, r.stdout)
    map.set(rel, dest)
  })
  return map
}

/** 乱码检查要读的暂存文件后缀。 */
const MOJIBAKE_EXT_RE = /\.(ts|tsx|md|json|mjs|cjs)$/i
/** bug-patterns 与类型门禁关心的后缀。 */
const TS_EXT_RE = /\.tsx?$/i
/** 类型门禁的触发范围：只有 src/ 下的 TS/TSX 改动才值得付出全量 typecheck 的时间。 */
const SRC_TS_RE = /^src[/\\].*\.tsx?$/i
/**
 * 单个子进程的硬上限。git_commit 的 run_checks=true 是在模型回合中间同步跑的，
 * spawnSync 会一直阻塞事件循环——不设上限的话，一次挂死的 tsc 就能把整个会话卡住。
 * 超时后 Node 会 SIGTERM 子进程，足够回收；这里不需要更重的信号处理。
 */
export const SUBPROCESS_TIMEOUT_MS = 120_000
/** 子进程输出上限，防止 tsc 的海量报错把上下文撑爆（保留尾部，最有信息量的部分）。 */
const MAX_CAPTURE = 64 * 1024

/** 统一收口 spawnSync 的超时、错误与输出截断。 */
function spawnCapped(command, args, options = {}) {
  const result = spawnSync(command, args, { encoding: "utf8", timeout: SUBPROCESS_TIMEOUT_MS, ...options })
  if (result.error) {
    const timedOut = result.error.code === "ETIMEDOUT"
    return {
      // 124 是 timeout 的约定退出码，与 shell 的 `timeout` 语义一致；其余按 127（命令不可用）
      code: timedOut ? 124 : 127,
      out: "",
      err: timedOut
        ? `命令超时（>${SUBPROCESS_TIMEOUT_MS / 1000}s）被终止：${command} ${args.join(" ")}`
        : String(result.error.message ?? result.error),
    }
  }
  return {
    code: result.status ?? 1,
    out: tail(String(result.stdout ?? "")),
    err: tail(String(result.stderr ?? "")),
  }
}

/** 超过上限时只保留尾部，并标注已被截断。 */
function tail(text) {
  if (text.length <= MAX_CAPTURE) return text
  return `...[已截断 ${text.length - MAX_CAPTURE} 字符]...\n${text.slice(-MAX_CAPTURE)}`
}

/**
 * 取暂存区的文件列表（相对当前工作目录，与原 shell 管道行为一致）。
 * git 不可用或出错时返回空列表——交由调用方决定是否降级。
 */
export function stagedFiles(cwd, diffFilter = "ACM") {
  const result = spawnCapped("git", ["diff", "--cached", "--name-only", `--diff-filter=${diffFilter}`], { cwd })
  if (result.code !== 0) return []
  return result.out
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
}

/** 以当前 Node/Bun 运行时执行仓库内的一个 node 脚本。 */
function runNodeScript(cwd, scriptPath, args) {
  return spawnCapped(process.execPath, [scriptPath, ...args], { cwd })
}

/**
 * 跑 tsc。优先用仓库本地安装的 typescript（确定性、不联网、快），
 * 缺失时回落到 `bun x tsc`，与 pre-commit 原有行为一致。
 */
export function runTypecheck(root, project = "tsconfig.json") {
  const local = join(root, "node_modules", "typescript", "bin", "tsc")
  if (existsSync(local)) {
    return spawnCapped(process.execPath, [local, "--noEmit", "-p", project], { cwd: root })
  }
  return spawnCapped("bun", ["x", "tsc", "--noEmit", "-p", project], { cwd: root })
}

const pass = (id, title, files = []) => ({ id, title, status: "pass", files, output: "" })
const fail = (id, title, result, files = []) => ({
  id,
  title,
  status: "fail",
  files,
  output: [result.out, result.err].map((s) => s.trim()).filter(Boolean).join("\n").trim(),
})
const skipped = (id, title, reason, files = []) => ({ id, title, status: "skipped", files, output: reason })

/**
 * 执行四项检查。返回结构化结果，调用方（git_commit）可据此决定放行与否。
 *
 * @param options.cwd    执行 git diff 的工作目录，默认当前目录（与原 hook 一致）
 * @param options.root   仓库根目录，用于定位 scripts/ 与 tsconfig，默认自动探测
 * @param options.staged 暂存文件列表，默认由 stagedFiles() 现取
 * @param options.skipTypecheck 仅供单测使用：跳过真实 tsc
 */
export function runChecks(options = {}) {
  const cwd = options.cwd ?? process.cwd()
  const root = options.root ?? detectRoot(cwd) ?? cwd
  const staged = options.staged ?? stagedFiles(cwd)
  const indexSnap = snapshotIndex(cwd, staged)
  const snapOf = (list) => list.map((f) => indexSnap.get(f) ?? f)
  const checks = []

  // 1. UTF-8 乱码防线
  const mojibakeFiles = staged.filter((f) => MOJIBAKE_EXT_RE.test(f))
  if (mojibakeFiles.length === 0) {
    checks.push(skipped("mojibake", "UTF-8 乱码防线", "暂存区没有需要检查的文本文件", mojibakeFiles))
  } else {
    const r = runNodeScript(cwd, join(root, "scripts", "check-mojibake.mjs"), snapOf(mojibakeFiles))
    checks.push(r.code === 0 ? pass("mojibake", "UTF-8 乱码防线", mojibakeFiles) : fail("mojibake", "UTF-8 乱码防线", r, mojibakeFiles))
  }

  // 2. 品牌合规守卫（扫 src/cli 等自有文案高危区，与暂存内容无关）
  {
    const r = runNodeScript(cwd, join(root, "scripts", "brand-guard.mjs"), [root])
    checks.push(r.code === 0 ? pass("brandGuard", "品牌合规守卫") : fail("brandGuard", "品牌合规守卫", r))
  }

  // 3. 高频缺陷模式防线（只查暂存的 TS 文件）
  const tsFiles = staged.filter((f) => TS_EXT_RE.test(f))
  if (tsFiles.length === 0) {
    checks.push(skipped("bugPatterns", "高频缺陷模式防线", "暂存区没有 TS/TSX 文件", tsFiles))
  } else {
    const r = runNodeScript(cwd, join(root, "scripts", "check-bug-patterns.mjs"), snapOf(tsFiles))
    checks.push(r.code === 0 ? pass("bugPatterns", "高频缺陷模式防线", tsFiles) : fail("bugPatterns", "高频缺陷模式防线", r, tsFiles))
  }

  // 4. 工作区垃圾文件（.bak/.orig 等，.gitignore 第 7 条）——与暂存内容无关的全仓扫
  {
    const r = runNodeScript(cwd, join(root, "scripts", "check-workspace-junk.mjs"), [root])
    checks.push(r.code === 0 ? pass("workspaceJunk", "工作区垃圾文件检查") : fail("workspaceJunk", "工作区垃圾文件检查", r))
  }

  // 5. 类型门禁：仅当暂存区含 src/ 下 TS/TSX 才跑全量 typecheck
  const srcTsFiles = tsFiles.filter((f) => SRC_TS_RE.test(f))
  if (options.skipTypecheck) {
    checks.push(skipped("typecheck", "类型门禁 tsc --noEmit", "调用方显式要求跳过"))
  } else if (srcTsFiles.length === 0) {
    checks.push(skipped("typecheck", "类型门禁 tsc --noEmit", "暂存区没有 src/ 下的 TS/TSX 改动", srcTsFiles))
  } else {
    const r = runTypecheck(root, options.project ?? "tsconfig.json")
    checks.push(r.code === 0 ? pass("typecheck", "类型门禁 tsc --noEmit", srcTsFiles) : fail("typecheck", "类型门禁 tsc --noEmit", r, srcTsFiles))
  }

  return { ok: checks.every((c) => c.status !== "fail"), checks }
}

/** 探测 git 仓库根；失败返回 null。 */
export function detectRoot(cwd = process.cwd()) {
  const result = spawnCapped("git", ["rev-parse", "--show-toplevel"], { cwd })
  if (result.code !== 0) return null
  const top = result.out.trim()
  return top ? top : null
}

/** 把结构化结果渲染成人读的文本。 */
export function formatReport(report) {
  const lines = []
  for (const check of report.checks) {
    const mark = check.status === "pass" ? "PASS" : check.status === "fail" ? "FAIL" : "SKIP"
    lines.push(`[${mark}] ${check.title}`)
    if (check.status === "skipped") lines.push(`       ${check.output}`)
    if (check.status === "fail" && check.output) lines.push(check.output)
  }
  return lines.join("\n")
}

/** git_commit 回灌用的紧凑摘要：只列失败项。 */
export function formatFailures(report) {
  return report.checks
    .filter((c) => c.status === "fail")
    .map((c) => ({ id: c.id, title: c.title, output: c.output.slice(0, 4000) }))
}

function isDirectRun() {
  const entry = process.argv[1]
  if (!entry) return false
  try {
    return realpathSync(entry) === realpathSync(fileURLToPath(import.meta.url))
  } catch {
    return false
  }
}

if (isDirectRun()) {
  const root = detectRoot() ?? process.cwd()
  const report = runChecks({ root })
  console.log(formatReport(report))
  process.exit(report.ok ? 0 : 1)
}
