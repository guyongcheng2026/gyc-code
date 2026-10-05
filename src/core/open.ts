import open from "open"

/**
 * 在系统默认浏览器里打开 URL，仅接受 http/https。
 *
 * 为什么要有这层：直接调 `open()` 时，`file://`、`javascript:` 这类协议会被
 * 原样交给系统处理。MCP 服务器的授权地址、模型返回的链接都不可信，
 * 这里先卡协议，避免恶意链接被当成可执行动作拉起。
 */
export function openUrl(input: string) {
  const url = URL.canParse(input) ? new URL(input) : undefined
  if (!url || (url.protocol !== "http:" && url.protocol !== "https:"))
    return Promise.reject(new Error(`Only http and https links can be opened in the browser: ${input}`))
  return open(url.href)
}