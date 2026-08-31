// gyc-code 协议客户端 v1（兼容入口）
// ⚠️ FROZEN（2026-08-31）：v1 已冻结——仅允许存量消费（webapp sdk.ts 与插件宿主），
//    新功能一律使用 @gyccode/protocol/v2（API 覆盖完整且为协议基线）。
//    webapp v1→v2 迁移清单见 docs/PROTOCOL-V1-V2-MIGRATION.md，迁移完成后本入口退役。
// 源自 opencode SDK（MIT License，版权归 opencode 项目保留），本地化改造：
// 去除 @opencode-ai/sdk 外部依赖，仅保留历史 client 入口，供插件宿主使用。
export * from "./gen/types.gen.js"
import { createClient } from "./gen/client/client.gen.js"
import { GyccodeClient } from "./gen/sdk.gen.js"
import { wrapClientError } from "../v2/error-interceptor.js"
import { wrapConditionalGet } from "../conditional-cache.js"
export { GyccodeClient }

function pick(value: string | null, fallback: string | undefined) {
  if (!value) return
  if (!fallback) return value
  if (value === fallback) return fallback
  if (value === encodeURIComponent(fallback)) return fallback
  return value
}

function rewrite(request: Request, directory: string | undefined) {
  if (request.method !== "GET" && request.method !== "HEAD") return request
  const value = pick(request.headers.get("x-gyccode-directory"), directory)
  if (!value) return request
  const url = new URL(request.url)
  if (!url.searchParams.has("directory")) {
    url.searchParams.set("directory", value)
  }
  const next = new Request(url, request)
  next.headers.delete("x-gyccode-directory")
  return next
}

export function createGyccodeClient(config: Record<string, any>) {
  if (!config?.fetch) {
    const customFetch = (req: Request) => {
      // @ts-ignore
      req.timeout = false
      return fetch(req)
    }
    config = {
      ...config,
      fetch: customFetch,
    }
  }
  // 条件 GET 缓存：仅对带 etag 头的 /api/provider 响应激活，无 etag 的响应（含测试 mock）原样透传
  config = {
    ...config,
    fetch: wrapConditionalGet(config.fetch),
  }
  if (config?.directory) {
    config.headers = {
      ...config.headers,
      "x-gyccode-directory": encodeURIComponent(config.directory),
    }
  }
  const client = createClient(config)
  client.interceptors.request.use((request: Request) => rewrite(request, config?.directory))
  client.interceptors.response.use((response: Response) => {
    const contentType = response.headers.get("content-type")
    if (contentType === "text/html")
      throw new Error("Request is not supported by this version of gyc-code Server (Server responded with text/html)")
    return response
  })
  client.interceptors.error.use(wrapClientError)
  return new GyccodeClient({ client })
}
