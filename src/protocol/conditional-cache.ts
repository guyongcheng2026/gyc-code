/**
 * 条件 GET 缓存 fetch 包装器（ETag/If-None-Match/Cache-Control 客户端语义）。
 *
 * 配合服务端 GET /api/provider 响应中的 etag + cache-control 头使用：
 * - max-age 内的同 URL 读取直接回放缓存副本，零网络往返；
 * - 过期后自动带 If-None-Match 发条件请求，服务端内容未变返回 304，
 *   本层将 304 回放为缓存的 200 响应，上层（hey-api client）完全无感。
 *
 * 仅缓存精确路径 /api/provider（供应商目录，大响应体且低频变更）。
 * 缓存条目按完整 URL 区分（location query 不同即隔离）。
 * 逃生门：GYCCODE_DISABLE_CONDITIONAL_GET 置真时直通（调试/兼容排查）。
 */
const MAX_AGE_MS = 5000
const MAX_ENTRIES = 32
const CACHEABLE_PATH = "/provider"

type Entry = {
  etag: string
  body: string
  contentType: string | null
  storedAt: number
}

export type ConditionalGetFetch = (req: Request) => Promise<Response>

function truthy(key: string) {
  const value = process.env[key]?.toLowerCase()
  return value === "true" || value === "1"
}

export function wrapConditionalGet(fetchImpl: ConditionalGetFetch): ConditionalGetFetch {
  // 逃生门：运行时求值（测试/CLI 可在进程启动后设置环境变量）
  if (truthy("GYCCODE_DISABLE_CONDITIONAL_GET")) return fetchImpl
  const cache = new Map<string, Entry>()

  function replay(entry: Entry): Response {
    const headers = new Headers()
    if (entry.contentType) headers.set("content-type", entry.contentType)
    headers.set("etag", entry.etag)
    headers.set("x-gyccode-cache", "local")
    return new Response(entry.body, { status: 200, headers })
  }

  function touch(key: string, entry: Entry) {
    cache.delete(key)
    cache.set(key, entry)
    while (cache.size > MAX_ENTRIES) {
      const oldest = cache.keys().next().value
      if (oldest === undefined) break
      cache.delete(oldest)
    }
  }

  return async (req: Request): Promise<Response> => {
    let url: URL
    try {
      url = new URL(req.url)
    } catch {
      return fetchImpl(req)
    }
    if (req.method !== "GET" || url.pathname !== CACHEABLE_PATH) return fetchImpl(req)

    const key = req.url
    const entry = cache.get(key)
    if (entry && Date.now() - entry.storedAt < MAX_AGE_MS) {
      touch(key, entry)
      return replay(entry)
    }

    const conditionalReq = entry ? new Request(req, { headers: withIfNoneMatch(req.headers, entry.etag) }) : req
    const res = await fetchImpl(conditionalReq)

    if (res.status === 304 && entry) {
      touch(key, { ...entry, storedAt: Date.now() })
      return replay(entry)
    }
    if (res.ok && res.status !== 204) {
      const etag = res.headers.get("etag")
      if (etag) {
        const body = await res.text()
        touch(key, { etag, body, contentType: res.headers.get("content-type"), storedAt: Date.now() })
        const headers = new Headers(res.headers)
        headers.delete("content-length")
        return new Response(body, { status: res.status, statusText: res.statusText, headers })
      }
    }
    return res
  }
}

function withIfNoneMatch(headers: HeadersInit | undefined, etag: string): Headers {
  const h = new Headers(headers)
  h.set("if-none-match", etag)
  return h
}
