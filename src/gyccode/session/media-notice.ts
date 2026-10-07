/**
 * P2-5（对标指标 10 · 工具结果媒体的可见降级）
 *
 * 背景：工具返回的图片/PDF 在「模型 API 不接受 tool-result 媒体」时会被挪到
 * 独立消息、或干脆被 SDK 丢弃。若不告诉模型，它会默认「我已经看到图了」并据此
 * 编造内容——这类幻觉在实践中非常常见，Claude Code 同样存在这个问题。
 *
 * 这里只回答两个问题：模型吃不吃这类媒体？媒体被挪走/丢弃时该对模型说什么？
 */

/** 已知纯文本模型：这些模型不吃图片输入，给了也会被 SDK 丢弃 */
const TEXT_ONLY_MODEL =
  /(gpt-3\.5-turbo|gpt-4o-mini|o1-mini|deepseek-r1-distill|qwen2\.5-[0-3](?:\.5)?b|llama-?3\.2|phi-?[34]\b)/

/**
 * xAI 唯一接受的图片格式。上游 opencode 1.18.35 起按同一名单过滤：xAI 收到
 * 其他格式（如 GIF）会报 invalid_image 并让整个请求失败，而非只丢该附件。
 */
const XAI_IMAGE_MIME = new Set(["image/png", "image/jpeg", "image/webp"])

export interface ModelApiLike {
  npm: string
  id: string
}

/** 模型是否接受该媒体类型作为输入（与「能否放在 tool result 里」是两件事） */
export function modelAcceptsMedia(api: ModelApiLike, mime: string): boolean {
  const id = api.id.toLowerCase()
  const npm = api.npm

  if (mime === "application/pdf") {
    if (npm === "@ai-sdk/anthropic" || npm === "@ai-sdk/google-vertex/anthropic") return true
    if (npm === "@ai-sdk/openai") {
      return id.includes("gpt-4o") || id.includes("gpt-5") || id.includes("o3") || id.includes("o4")
    }
    if (npm === "@ai-sdk/google") return id.includes("gemini")
    // 未知 provider 一律保守判否：宁可不注入并说明，也不要静默丢弃
    return false
  }

  if (mime.startsWith("image/")) {
    if (npm === "@ai-sdk/xai") return XAI_IMAGE_MIME.has(mime)
    return !TEXT_ONLY_MODEL.test(id)
  }
  return true
}

export interface MediaLike {
  mime: string
  filename?: string
}

/**
 * 生成给模型看的媒体处置说明。
 * dropped=true 表示这些附件模型根本收不到，必须说清原因并禁止模型假设已读取。
 */
export function buildMediaNotice(list: Array<MediaLike>, dropped: boolean, reason: string): string {
  const names = list.map((a) => a.filename ?? a.mime).join("、")
  const fallback = `请改用不依赖该媒体格式的方式（如 read 抽取文本、describe_image 读元数据）`
  if (dropped) {
    return (
      `\n\n<media_notice>附件（${names}）已从工具结果中移除：${reason}。` +
      `你看不到它们的内容，不要假设已经读取过，更不要凭空描述它们；${fallback}。</media_notice>`
    )
  }
  return (
    `\n\n<media_notice>附件（${names}）未随工具结果直接发送，而是作为独立消息附上。` +
    `若你没有收到它，说明当前模型无法处理该媒体类型；${fallback}。</media_notice>`
  )
}