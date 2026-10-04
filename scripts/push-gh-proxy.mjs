// 推送当前 HEAD 到 GitHub，优先走代理通道。
//
// 由 .githooks/post-commit 调用，替代原先的 `git push origin HEAD`：
// 本机 NO_PROXY 含 github.com 且直连被出口拒，原写法每次提交都要等约 21 秒
// 超时后失败（记入 .git/worklog-sync.log）。代理通道实测可用。
//
// 设计要点：
// - 代理选择顺序：GYCCODE_PUSH_PROXY > GH_PROXY > 无（无则回落直连，保持旧行为）
// - 凭据来源：git credential fill（host 取自 origin URL），仅存于本进程内存
// - 令牌绝不写入日志/文件；输出前统一脱敏
// - 幂等：远端已是最新时 git 返回 0，视为成功
// - 任何失败都只输出错误摘要并以非 0 退出，由调用方决定是否阻塞
//
// 用法：node scripts/push-gh-proxy.mjs [--dry-run]
import { execFileSync } from "node:child_process"
import { buildProxyRemote, parseCredential, pickProxy } from "./push-proxy.mjs"

const DRY_RUN = process.argv.includes("--dry-run")

function git(args, input) {
  return execFileSync("git", args, {
    encoding: "utf8",
    input,
    stdio: ["pipe", "pipe", "pipe"],
    maxBuffer: 32 * 1024 * 1024,
  })
}

/** 脱敏：把 URL 里的 user:token@ 段替换为 ***@ */
function mask(text) {
  return String(text).replace(/:\/\/[^/\s@]*@/g, "://***@")
}

function fail(reason, detail) {
  process.stderr.write(`[push-proxy] ${reason}\n`)
  if (detail) process.stderr.write(mask(detail).trim() + "\n")
  process.exit(1)
}

// 1. 取 origin URL，推断凭据 host
let originUrl
try {
  originUrl = git(["config", "--get", "remote.origin.url"]).trim()
} catch (e) {
  fail("读不到 remote.origin.url，跳过推送", e.message)
}
if (!originUrl || originUrl.startsWith("/") || originUrl.includes("@")) {
  // 非 https 形态或已内嵌凭据：不处理，交给原有链路
  process.stderr.write(`[push-proxy] origin 非标准 https 形态，跳过\n`)
  process.exit(0)
}
let host = "github.com"
try {
  host = new URL(originUrl).host
} catch {
  // 保留默认
}

// 2. 选代理
const proxy = pickProxy(process.env)
if (!proxy) {
  process.stderr.write("[push-proxy] 未配置代理（GH_PROXY），回落直连\n")
  try {
    git(["push", "--quiet", "origin", "HEAD"])
    process.stderr.write("[push-proxy] 直连推送成功\n")
  } catch (e) {
    fail("直连推送失败", e.stderr || e.message)
  }
  process.exit(0)
}

// 3. 取凭据
let cred
try {
  cred = parseCredential(git(["credential", "fill"], `protocol=https\nhost=${host}\n\n`))
} catch (e) {
  fail(`读取 ${host} 凭据失败`, e.stderr || e.message)
}
if (!cred) fail(`未找到 ${host} 的可用凭据（git credential fill 无 password 字段）`)

// 4. 推送
const remote = buildProxyRemote(proxy, originUrl, cred.username, cred.token)
if (DRY_RUN) {
  process.stdout.write(`[push-proxy] dry-run：proxy=${proxy} remote=${mask(remote)}\n`)
  process.exit(0)
}
// 推送目标必须是「当前分支」，不能写死 main：在特性分支上提交后执行本脚本，
// 写死 main 会把提交直接推到 main，绕过 review，且与无代理时 `push origin HEAD`
// 的同名推送语义不一致（那才是本脚本要对齐的回退行为）。
// detached HEAD 时 rev-parse 返回 HEAD，此时退回不带 refspec 的推送，
// 由 git 自身的 push.default 决定目标，绝不猜一个分支名。
let currentBranch = "HEAD"
try {
  const name = git(["rev-parse", "--abbrev-ref", "HEAD"]).trim()
  if (name && name !== "HEAD") currentBranch = name
} catch {
  // 取不到分支名就用 HEAD，保持与回退链路一致
}
try {
  git(["-c", "credential.helper=", "push", remote, `HEAD:${currentBranch}`])
  process.stderr.write(`[push-proxy] 经 ${proxy} 推送 ${currentBranch} 成功\n`)
} catch (e) {
  fail(`经 ${proxy} 推送失败`, e.stderr || e.message)
}
