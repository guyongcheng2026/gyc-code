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
  repo: "\u4ed3\u5e93\uff1a\u672c\u5730 `C:\\Users\\\u8c37\u52c7\u6210\\gyc-cli` / \u7528\u6237 `guyongcheng2026/gyc-code`\uff08gh-proxy\uff09",
  title: "# gyc-code \u5de5\u4f5c\u6d41\u6c34\uff08\u81ea\u52a8\u540c\u6b65\uff09",
  h2: "## \u63d0\u4ea4\u8bf0",
}
const VAULT = "E:\\" + W.name
const worklog = path.join(VAULT, W.dir, W.file)
const REPO = process.cwd()
const LOGFILE = path.join(REPO, ".git", "worklog-sync.log")

const glog = (m) => { try { fs.appendFileSync(LOGFILE, `[${new Date().toISOString()}] ${m}\n`, "utf8") } catch {} }

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
  const head = git(REPO, ["rev-parse", "--short", "HEAD"])
  glog("HEAD=" + head)
  fs.mkdirSync(path.dirname(worklog), { recursive: true })
  if (fs.existsSync(worklog) && fs.readFileSync(worklog, "utf8").includes("[" + head + "]")) {
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
    body = fs.readFileSync(worklog, "utf8")
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