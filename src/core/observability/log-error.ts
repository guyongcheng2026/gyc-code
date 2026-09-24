/**
 * 统一错误日志入口。
 *
 * 各处原先手写 `console.error(\`[tag] ... ${String(e)}\`)` 约 70 处，格式与字段
 * 各不相同：没有 sessionID/traceId 时，线上根本无法按会话聚合排查"某次请求为什么
 * 失败"。这里固定 scope 前缀并支持透传结构化字段，新增调用点一律走它。
 */

const format = (error: unknown): string =>
  error instanceof Error ? (error.stack ?? error.message) : String(error)

/** 按 scope 记录错误；fields 会作为第二个参数输出，便于 grep/日志管道提取。 */
export function logError(scope: string, error: unknown, fields?: Record<string, unknown>): void {
  if (fields && Object.keys(fields).length > 0) {
    console.error(`[${scope}] ${format(error)}`, fields)
    return
  }
  console.error(`[${scope}] ${format(error)}`)
}

/** 同 logError，但用于降级/重试这类非致命路径，避免与错误混在一起。 */
export function logWarn(scope: string, message: string, fields?: Record<string, unknown>): void {
  if (fields && Object.keys(fields).length > 0) {
    console.warn(`[${scope}] ${message}`, fields)
    return
  }
  console.warn(`[${scope}] ${message}`)
}
