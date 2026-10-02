// GitHub 推送代理：URL 拼装与凭据解析（纯函数，供脚本与单测共用）
//
// 背景（2026-10-02 实测）：本机 NO_PROXY 含 github.com，直连被出口策略拒；
// 两个 URL-prefix 型代理中 ghfast.top 读写皆通，gh-proxy.com 仅 fetch 可用。
// 唯一实测可用的推送方式是「凭据 URL 内嵌」——GIT_ASKPASS 与 http.extraHeader
// 对嵌套 URL 不生效，git 会退化为匿名请求（No anonymous write access）。
//
// 口令只在本进程内存与拼出的 URL 中出现，不写文件、不进日志。
// 本文件为 .mjs 而非 .ts：post-commit 钩子以 node 执行，仓库内 .mjs 脚本
// （worklog-sync / sync-manual / gen-compose-bundle）均遵循此约定。

/** 代理选择：显式覆盖 > GH_PROXY > 未设置。 */
export function pickProxy(env) {
  const explicit = (env.GYCCODE_PUSH_PROXY || "").trim()
  if (explicit) return normalizeProxy(explicit)
  const fromEnv = (env.GH_PROXY || "").trim()
  if (fromEnv) return normalizeProxy(fromEnv)
  return undefined
}

/** 去掉尾部斜杠；无协议时补 https://。 */
function normalizeProxy(proxy) {
  let out = String(proxy).replace(/\/+$/, "")
  if (!/^https?:\/\//i.test(out)) out = "https://" + out
  return out
}

/** 解析 `git credential fill` 的输出；缺 password 返回 null。 */
export function parseCredential(raw) {
  if (!raw) return null
  const fields = new Map()
  for (const line of String(raw).split(/\r?\n/)) {
    const idx = line.indexOf("=")
    if (idx <= 0) continue
    fields.set(line.slice(0, idx), line.slice(idx + 1))
  }
  const token = fields.get("password")
  if (!token) return null
  return { username: fields.get("username") || "x-access-token", token }
}

/** 拼出带凭据的代理 remote URL；用户名与口令分别 URL 编码。 */
export function buildProxyRemote(proxy, originUrl, username, token) {
  const base = normalizeProxy(proxy)
  // 显式拆协议与主机：直接 replace("://") 会在凭据含特殊字符时误伤
  const sep = base.indexOf("://")
  const scheme = base.slice(0, sep)
  const host = base.slice(sep + 3)
  const u = encodeURIComponent(username)
  const t = encodeURIComponent(token)
  return `${scheme}://${u}:${t}@${host}/${String(originUrl).replace(/^\/+/, "")}`
}
