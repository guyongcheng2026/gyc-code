// scripts/worklog-sync.mjs - Obsidian vault auto-sync (bound to .githooks/post-commit)
// Appends the latest gyc-cli commit metadata to the Obsidian work log, then
// commits and pushes the vault repo (gitee). Idempotent + fail-soft.
import { spawnSync } from "node:child_process"
import fs from "node:fs"
import path from "node:path"

// ---- Chinese strings (unicode escapes keep this source fully ASCII) ----
const W = {
  name: "\u8c37\u52c7\u6210\u7684\u77e5\u8bc6\u5e93",            // 谷勇成的知识库
  dir:  "2001.\u6211\u7684\u52a9\u624b\u5de5\u5177\u94fe",            // 2001.我的助手工具链
  file: "gyc-code-\u5de5\u4f5c\u6d41\u6c34.md",                  // gyc-code-工作流水.md
  about: "\u6bcf\u6b21 `git commit` \u540e\u7531 `.githooks/post-commit` \u81ea\u52a8\u8ffd\u52a0",
  repo: "\u4ed3\u5e93\uff1a\u672c\u5730 `C:\\gyc-code` / \u7528\u6237 `guyongcheng2026/gyc-code`\uff08gh-proxy\uff09",
  title: "# gyc-code \u5de5\u4f5c\u6d41\u6c34\uff08\u81ea\u52a8\u540c\u6b65\uff09",
  h2: "## \u63d0\u4ea4\u8bf0",
}
const VAULT = "E:\\" + W.name
const worklog = path.join(VAULT, W.dir, W.file)
const REPO = process.cwd()
const LOGFILE = path.join(REPO, ".git", "worklog-sync.log")
// 防并发 TOCTOU：post-commit 钩子与手动补跑同时执行时，双方都读到“无该 hash”
// 状态各自追加会导致重复条目。用 O_EXCL 锁文件互斥；残留锁超 10 分钟视为过期可抢占。
const LOCKFILE = path.join(REPO, ".git", "worklog-sync.lock")
const LOCK_STALE_MS = 10 * 60 * 1000
function acquireLock() {
  try {
    fs.openSync(LOCKFILE, "wx")
    return true
  } catch {
    try {
      const stat = fs.statSync(LOCKFILE)
      if (Date.now() - stat.mtimeMs > LOCK_STALE_MS) {
        fs.rmSync(LOCKFILE, { force: true })
        fs.openSync(LOCKFILE, "wx")
        return true
      }
    } catch {}
    return false
  }
}

const glog = (m) => { try { fs.appendFileSync(LOGFILE, `[${new Date().toISOString()}] ${m}\n`, "utf8") } catch {} }
// 读取既有日志文件：UTF-8 严格解码失败（如被记事本另存为 GBK）则按 GB18030 读入，
// 追加后统一写回 UTF-8 无 BOM（Obsidian 正常渲染），避免追加内容混合乱码。
function decodeTextFile(file) {
  const bytes = fs.readFileSync(file)
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(bytes)
  } catch {
    return new TextDecoder("gb18030").decode(bytes)
  }
}

function git(root, args, opts = {}) {
  const res = spawnSync("git", ["-C", root, ...args], {
    encoding: "utf8", timeout: 60000,
    env: { ...process.env, GIT_TERMINAL_PROMPT: "0" },
    ...opts,
  })
  if (res.status !== 0) { const err = new Error((res.stderr || res.stdout || "git failed").trim().slice(0, 500)); err.status = res.status; throw err }
  return (res.stdout || "").trim()
}

function main() {
  if (!acquireLock()) {
    glog("another sync is running, skip")
    return
  }
  try {
    syncOnce()
  } finally {
    fs.rmSync(LOCKFILE, { force: true })
  }
}

function syncOnce() {
  const head = git(REPO, ["rev-parse", "--short", "HEAD"])
  glog("HEAD=" + head)
  fs.mkdirSync(path.dirname(worklog), { recursive: true })
  if (fs.existsSync(worklog) && decodeTextFile(worklog).includes("[" + head + "]")) {
    glog("already recorded, skip")
    return
  }
  const date = git(REPO, ["log", "-1", "--format=%cs"])
  const subject = git(REPO, ["log", "-1", "--format=%s"])
  let files = []
  try {
    files = git(REPO, ["show", "--format=", "--name-only", "HEAD"]).split("\n").filter(Boolean)
  } catch {}
  const entry = "\n- [OK] " + date + " [" + head + "] " + subject +
    "\n  - [FILES] " + files.length + ": " + files.slice(0, 6).join(", ") + (files.length > 6 ? " ..." : "") + "\n"

  let body = ""
  if (!fs.existsSync(worklog)) {
    body = [W.title, "", "> " + W.about, "> " + W.repo, "", W.h2, ""].join("\n")
  } else {
    body = decodeTextFile(worklog)
  }
  body += entry
  fs.writeFileSync(worklog, body, "utf8")
  glog("entry appended (" + head + ")")

  git(VAULT, ["add", "--", worklog])
  const cm = spawnSync("git", ["-C", VAULT, "commit", "-m", "\u2705 gyc-code: " + head + " " + subject.slice(0, 50)], { encoding: "utf8", timeout: 60000, env: { ...process.env, GIT_TERMINAL_PROMPT: "0" } })
  if (cm.status !== 0) { glog("vault commit failed (non-blocking): " + (cm.stderr || cm.stdout || "").trim().slice(0, 300)); return }
  glog("vault commit ok")
  try { git(VAULT, ["push", "origin", "HEAD"]); glog("vault push ok") }
  catch (e) { glog("vault push failed (non-blocking): " + e.message) }
}

try { main() } catch (e) {
  try { glog("FATAL: " + e.message) } catch {}
}
process.exit(0)