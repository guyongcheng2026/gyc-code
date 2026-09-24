import { Context } from "effect"

const gyccodeOrigin = /^https:\/\/([a-z0-9-]+\.)*gyccode\.ai$/

export type CorsOptions = { readonly cors?: ReadonlyArray<string> }

export const CorsConfig = Context.Reference<CorsOptions | undefined>("@gyccode/ServerCorsConfig", {
  defaultValue: () => undefined,
})

export function isAllowedCorsOrigin(input: string | undefined, opts?: CorsOptions) {
  if (!input) return true
  // 不再无条件放行 http://localhost:<任意端口> / http://127.0.0.1:<任意端口>：
  // 服务器默认回环监听且未设口令时，通配回环来源等于放行本机任意端口的页面
  // （被污染的 dev server、本地应用 XSS、恶意依赖起的服务）跨源读取本 API 响应。
  // 同源请求由 isAllowedRequestOrigin 的 sameHost 判定放行；跨源需求用 opts.cors 显式声明。
  if (input.startsWith("oc://renderer")) return true
  if (input === "tauri://localhost" || input === "http://tauri.localhost" || input === "https://tauri.localhost")
    return true
  if (gyccodeOrigin.test(input)) return true
  return opts?.cors?.includes(input) ?? false
}

export function isAllowedRequestOrigin(input: string | undefined, host: string | undefined, opts?: CorsOptions) {
  if (!input) return true
  if (host && sameHost(input, host)) return true
  return isAllowedCorsOrigin(input, opts)
}

function sameHost(origin: string, host: string) {
  try {
    return new URL(origin).host === host
  } catch {
    return false
  }
}
