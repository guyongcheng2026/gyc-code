import { Effect, Schema } from "effect"
import { HttpClient, HttpClientRequest, HttpClientResponse } from "effect/unstable/http"
import * as FetchHttpClient from "effect/unstable/http/FetchHttpClient"
import { Parser } from "htmlparser2"
import * as Tool from "./tool"
import TurndownService from "turndown"
import DESCRIPTION from "./webfetch.txt"
import { isImageAttachment } from "@/util/media"
import { isIPv4 } from "net"
import { lookup } from "dns/promises"
import { summarizeText, type Summarizer } from "./summarize"

const MAX_RESPONSE_SIZE = 5 * 1024 * 1024 // 5MB
const DEFAULT_TIMEOUT = 30 * 1000 // 30 seconds
const MAX_REDIRECTS = 5

// 检查主机名是否为私网/回环/链路本地地址（SSRF 防护）
function isPrivateHost(hostname: string): boolean {
  // 回环地址
  if (hostname === "localhost" || hostname === "::1" || hostname === "0.0.0.0") return true

  const h = hostname.toLowerCase()

  // IPv4-mapped IPv6（::ffff:a.b.c.d）：提取内嵌 IPv4 后按 IPv4 规则校验，
  // 防止用映射地址形式绕过私网拦截（如 ::ffff:10.1.2.3 实际连接 10.1.2.3）
  const mapped = h.match(/^::ffff:(\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3})$/)
  if (mapped) return isPrivateIPv4(mapped[1])

  // IPv4 私网/回环/链路本地
  if (isIPv4(hostname)) return isPrivateIPv4(hostname)

  // IPv6 私网/链路本地
  if (hostname.includes(":")) {
    if (h.startsWith("fc") || h.startsWith("fd")) return true // 私网 fc00::/7
    if (h.startsWith("fe80")) return true // 链路本地 fe80::/10
  }

  // 云元数据端点常见主机名
  const blocklist = ["169.254.169.254", "metadata.google.internal", "instance-data/latest"]
  if (blocklist.includes(hostname)) return true
  return false
}

// 判断 IPv4 地址是否属于私网/回环/链路本地/当前网络段
function isPrivateIPv4(ip: string): boolean {
  const parts = ip.split(".").map(Number)
  // 非法地址（非数字/越界）一律视为不安全，fail-closed
  if (parts.length !== 4 || parts.some((p) => Number.isNaN(p) || p < 0 || p > 255)) return true
  if (parts[0] === 127) return true // 回环 127.0.0.0/8
  if (parts[0] === 10) return true // 私网 10.0.0.0/8
  if (parts[0] === 172 && parts[1] >= 16 && parts[1] <= 31) return true // 私网 172.16.0.0/12
  if (parts[0] === 192 && parts[1] === 168) return true // 私网 192.168.0.0/16
  if (parts[0] === 169 && parts[1] === 254) return true // 链路本地 169.254.0.0/16
  if (parts[0] === 0) return true // 当前网络 0.0.0.0/8
  return false
}

/**
 * Follows HTTP redirects manually, re-validating the SSRF blocklist on every
 * hop. Native redirect following is disabled via `redirect: "manual"`, because
 * the initial-URL-only check would otherwise be bypassed by a 3xx response
 * pointing at a private/loopback/metadata address.
 */
export function redirectLoop(
  client: HttpClient.HttpClient,
  request: HttpClientRequest.HttpClientRequest,
  remaining: number,
): Effect.Effect<HttpClientResponse.HttpClientResponse, Error> {
  return Effect.gen(function* () {
    const response = yield* client.execute(request)
    const status = response.status
    if (remaining <= 0 || status < 300 || status >= 400) return response
    const location = response.headers["location"]
    if (!location) return response
    const next = new URL(location, response.request.url)
    if (isPrivateHost(next.hostname)) {
      throw new Error(`Redirect target points to a private/loopback address: ${next.hostname}`)
    }
    const resolved = yield* Effect.tryPromise(() => lookup(next.hostname, { all: true })).pipe(
      Effect.catch(() => Effect.fail(new Error(`Unable to resolve ${next.hostname} for SSRF safety check`))),
    )
    if (resolved.some((entry) => isPrivateHost(entry.address))) {
      throw new Error(`Redirect target resolves to a private/loopback address: ${next.hostname}`)
    }
    return yield* redirectLoop(client, HttpClientRequest.setUrl(request, next), remaining - 1)
  })
}
const MAX_TIMEOUT = 120 * 1000 // 2 minutes

export const Parameters = Schema.Struct({
  url: Schema.String.annotate({ description: "The URL to fetch content from" }),
  format: Schema.Literals(["text", "markdown", "html"])
    .annotate({
      description: "The format to return the content in (text, markdown, or html). Defaults to markdown.",
      default: "markdown",
    })
    .pipe(Schema.withDecodingDefault(Effect.succeed("markdown" as const))),
  timeout: Schema.optional(Schema.Number).annotate({ description: "Optional timeout in seconds (max 120)" }),
})

export const WebFetchTool = Tool.define(
  "webfetch",
  Effect.gen(function* () {
    const http = yield* HttpClient.HttpClient

    return {
      description: DESCRIPTION,
      parameters: Parameters,
      execute: (params: Schema.Schema.Type<typeof Parameters>, ctx: Tool.Context) =>
        Effect.gen(function* () {
          if (!params.url.startsWith("http://") && !params.url.startsWith("https://")) {
            throw new Error("URL must start with http:// or https://")
          }

          // SSRF 防护：拒绝私网/回环/链路本地地址
          const parsedUrl = new URL(params.url)
          if (isPrivateHost(parsedUrl.hostname)) {
            throw new Error(`URL points to a private/loopback address: ${parsedUrl.hostname}`)
          }

          // DNS 解析后二次校验，防 DNS rebinding（域名首次解析为公网、实际连接时解析到内网）。
          // 解析失败时 fail-closed：无法确认目标地址安全就不放行，避免绕过 SSRF 防护。
          const resolved = yield* Effect.tryPromise(() => lookup(parsedUrl.hostname, { all: true })).pipe(
            Effect.catch(() =>
              Effect.fail(new Error(`Unable to resolve ${parsedUrl.hostname} for SSRF safety check`)),
            ),
          )
          if (resolved.some((entry) => isPrivateHost(entry.address))) {
            throw new Error("URL resolves to a private/loopback address: " + parsedUrl.hostname)
          }

          yield* ctx.ask({
            permission: "webfetch",
            patterns: [params.url],
            always: ["*"],
            metadata: {
              url: params.url,
              format: params.format,
              timeout: params.timeout,
            },
          })

          const timeout = Math.min((params.timeout ?? DEFAULT_TIMEOUT / 1000) * 1000, MAX_TIMEOUT)

          // Build Accept header based on requested format with q parameters for fallbacks
          let acceptHeader = "*/*"
          switch (params.format) {
            case "markdown":
              acceptHeader = "text/markdown;q=1.0, text/x-markdown;q=0.9, text/plain;q=0.8, text/html;q=0.7, */*;q=0.1"
              break
            case "text":
              acceptHeader = "text/plain;q=1.0, text/markdown;q=0.9, text/html;q=0.8, */*;q=0.1"
              break
            case "html":
              acceptHeader =
                "text/html;q=1.0, application/xhtml+xml;q=0.9, text/plain;q=0.8, text/markdown;q=0.7, */*;q=0.1"
              break
            default:
              acceptHeader =
                "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8"
          }
          const headers = {
            "User-Agent":
              "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/143.0.0.0 Safari/537.36",
            Accept: acceptHeader,
            "Accept-Language": "en-US,en;q=0.9",
          }

          const request = HttpClientRequest.get(params.url).pipe(HttpClientRequest.setHeaders(headers))

          // Disable native redirect following and follow each hop manually so
          // every redirect target is re-checked against the SSRF blocklist.
          const fetchWithSsrf = (req: HttpClientRequest.HttpClientRequest) => redirectLoop(http, req, MAX_REDIRECTS)

          // Retry with honest UA if blocked by Cloudflare bot detection (TLS fingerprint mismatch)
          const response = yield* fetchWithSsrf(request)
            .pipe(
              Effect.flatMap((res) => {
                if (res.status === 403 && res.headers["cf-mitigated"] === "challenge") {
                  return fetchWithSsrf(
                    HttpClientRequest.get(params.url).pipe(
                      HttpClientRequest.setHeaders({ ...headers, "User-Agent": "gyccode" }),
                    ),
                  )
                }
                return Effect.succeed(res)
              }),
              Effect.timeoutOrElse({ duration: timeout, orElse: () => Effect.die(new Error("Request timed out")) }),
            )
            .pipe(Effect.provideService(FetchHttpClient.RequestInit, { redirect: "manual" }))

          // Check content length
          const contentLength = response.headers["content-length"]
          if (contentLength && parseInt(contentLength) > MAX_RESPONSE_SIZE) {
            throw new Error("Response too large (exceeds 5MB limit)")
          }

          const arrayBuffer = yield* response.arrayBuffer
          if (arrayBuffer.byteLength > MAX_RESPONSE_SIZE) {
            throw new Error("Response too large (exceeds 5MB limit)")
          }

          const contentType = response.headers["content-type"] || ""
          const mime = contentType.split(";")[0]?.trim().toLowerCase() || ""
          const title = `${params.url} (${contentType})`

          if (isImageAttachment(mime)) {
            const base64Content = Buffer.from(arrayBuffer).toString("base64")
            return {
              title,
              output: "Image fetched successfully",
              metadata: {},
              attachments: [
                {
                  type: "file" as const,
                  mime,
                  url: `data:${mime};base64,${base64Content}`,
                },
              ],
            }
          }

          const content = new TextDecoder().decode(arrayBuffer)

          // Summarize large text responses with a cheap model when a summarizer
          // is available in context (aligned with reference agent's Haiku-based
          // WebFetch summarization). Falls back to raw content otherwise.
          const summarizer = (ctx.extra?.["summarizer"] as Summarizer | undefined) ?? (async (text: string) => text)

          // Handle content based on requested format and actual content type
          switch (params.format) {
            case "markdown":
              if (contentType.includes("text/html")) {
                const markdown = convertHTMLToMarkdown(content)
                return {
                  output: yield* Effect.promise(() => summarizeText(markdown, summarizer)),
                  title,
                  metadata: {},
                }
              }
              return {
                output: yield* Effect.promise(() => summarizeText(content, summarizer)),
                title,
                metadata: {},
              }

            case "text":
              if (contentType.includes("text/html")) {
                return {
                  output: yield* Effect.promise(() => summarizeText(extractTextFromHTML(content), summarizer)),
                  title,
                  metadata: {},
                }
              }
              return {
                output: yield* Effect.promise(() => summarizeText(content, summarizer)),
                title,
                metadata: {},
              }

            case "html":
              return { output: content, title, metadata: {} }

            default:
              return { output: content, title, metadata: {} }
          }
        }).pipe(Effect.orDie),
    }
  }),
)

function extractTextFromHTML(html: string) {
  let text = ""
  let skipDepth = 0

  const parser = new Parser({
    onopentag(name) {
      if (skipDepth > 0 || ["script", "style", "noscript", "iframe", "object", "embed"].includes(name)) {
        skipDepth++
      }
    },
    ontext(input) {
      if (skipDepth === 0) text += input
    },
    onclosetag() {
      if (skipDepth > 0) skipDepth--
    },
  })

  parser.write(html)
  parser.end()

  return text.trim()
}

function convertHTMLToMarkdown(html: string): string {
  const turndownService = new TurndownService({
    headingStyle: "atx",
    hr: "---",
    bulletListMarker: "-",
    codeBlockStyle: "fenced",
    emDelimiter: "*",
  })
  turndownService.remove(["script", "style", "meta", "link"])
  return turndownService.turndown(html)
}

