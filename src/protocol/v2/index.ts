// gyc-code 协议客户端 v2
// 源自 opencode SDK（MIT License，版权归 opencode 项目保留），本地化改造：
// 去除 @opencode-ai/sdk 外部依赖，客户端运行时落地到 @gyccode/protocol 包内。
export * from "./gen/types.gen.js"
import { createClient } from "./gen/client/client.gen.js"
import { GyccodeClient } from "./gen/sdk.gen.js"
import { wrapClientError } from "./error-interceptor.js"
export { GyccodeClient }

function pick(value, fallback, encode) {
  if (!value) return
  if (!fallback) return value
  if (value === fallback) return fallback
  if (encode && value === encode(fallback)) return fallback
  return value
}

function rewrite(request, values) {
  if (request.method !== "GET" && request.method !== "HEAD") return request
  const url = new URL(request.url)
  let changed = false
  for (const [name, key] of [
    ["x-gyccode-directory", "directory"],
    ["x-gyccode-workspace", "workspace"],
  ]) {
    const value = pick(
      request.headers.get(name),
      key === "directory" ? values.directory : values.workspace,
      key === "directory" ? encodeURIComponent : undefined,
    )
    if (!value) continue
    for (const query of url.pathname.startsWith("/api/") ? [key, `location[${key}]`] : [key]) {
      if (!url.searchParams.has(query)) {
        url.searchParams.set(query, value)
      }
    }
    changed = true
  }
  if (!changed) return request
  const next = new Request(url, request)
  next.headers.delete("x-gyccode-directory")
  next.headers.delete("x-gyccode-workspace")
  return next
}

export function createGyccodeClient(config) {
  if (!config?.fetch) {
    const customFetch = (req) => {
      // @ts-ignore
      req.timeout = false
      return fetch(req)
    }
    config = {
      ...config,
      fetch: customFetch,
    }
  }
  if (config?.directory) {
    config.headers = {
      ...config.headers,
      "x-gyccode-directory": encodeURIComponent(config.directory),
    }
  }
  if (config?.experimental_workspaceID) {
    config.headers = {
      ...config.headers,
      "x-gyccode-workspace": config.experimental_workspaceID,
    }
  }
  const client = createClient(config)
  client.interceptors.request.use((request) =>
    rewrite(request, {
      directory: config?.directory,
      workspace: config?.experimental_workspaceID,
    }),
  )
  client.interceptors.response.use((response) => {
    const contentType = response.headers.get("content-type")
    if (contentType === "text/html")
      throw new Error("Request is not supported by this version of gyc-code Server (Server responded with text/html)")
    return response
  })
  client.interceptors.error.use(wrapClientError)
  return new GyccodeClient({ client })
}
