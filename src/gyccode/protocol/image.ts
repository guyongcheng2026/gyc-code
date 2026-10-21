export type DestinationFilter = {
  readonly allow?: readonly string[]
  readonly deny?: readonly string[]
}

/** 本地/私有/保留主机名，默认拒绝，防止 SSRF。 */
const PRIVATE_HOSTS = new Set([
  "localhost",
  "127.0.0.1",
  "0.0.0.0",
  "::1",
])

function hostOf(url: string): string | undefined {
  try {
    return new URL(url).hostname
  } catch {
    return undefined
  }
}

/** 判断 URL 是否被 destination filter 允许。默认拒绝私有/保留主机。 */
export function isAllowed(url: string, filter?: DestinationFilter): boolean {
  const host = hostOf(url)
  if (!host) return false
  if (PRIVATE_HOSTS.has(host)) return false
  if (/^(10|172\.(1[6-9]|2[0-9]|3[0-1])|192\.168)\./.test(host)) return false
  if (filter?.deny?.includes(host)) return false
  if (filter?.allow?.length && !filter.allow.includes(host)) return false
  return true
}

/** 取图并返回原始字节与 MIME 类型。未通过过滤器时抛错。 */
export async function fetchImage(
  url: string,
  filter?: DestinationFilter,
): Promise<{ data: Uint8Array; mimeType: string }> {
  if (!isAllowed(url, filter)) {
    throw new Error(`Image URL blocked by destination filter: ${url}`)
  }
  const res = await fetch(url)
  if (!res.ok) {
    throw new Error(`Failed to fetch image: ${res.status} ${url}`)
  }
  const arrayBuffer = await res.arrayBuffer()
  const mimeType = res.headers.get("content-type") ?? "application/octet-stream"
  return { data: new Uint8Array(arrayBuffer), mimeType }
}

/** 图像预处理（缩放/格式转换）。无 OpenCV 依赖时原样返回字节，预留接口。 */
export async function preprocessImage(
  data: Uint8Array,
  opts?: { readonly width?: number; readonly height?: number; readonly format?: "jpeg" | "png" },
): Promise<Uint8Array> {
  return data
}

/** 字节 → base64 data URL。 */
export function imageToDataUrl(data: Uint8Array, mimeType: string): string {
  const base64 = Buffer.from(data).toString("base64")
  return `data:${mimeType};base64,${base64}`
}
