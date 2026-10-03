/**
 * 统一错误日志入口。
 *
 * 各处原先手写 `console.error(\`[tag] ... ${String(e)}\`)` 约 70 处，格式与字段
 * 各不相同：没有 sessionID/traceId 时，线上根本无法按会话聚合排查"某次请求为什么
 * 失败"。这里固定 scope 前缀并支持透传结构化字段，新增调用点一律走它。
 */

import type { SessionID } from "@gyccode/schema/session-id"
import { dispatchErrorAudit } from "./error-audit"

const format = (error: unknown): string =>
  error instanceof Error ? (error.stack ?? error.message) : String(error)

/**
 * 从 fields 里挑出 session 维度。落库表需要它做聚合，但绝大多数调用点本来就没有
 * 会话上下文，所以这里是可选提取而不是新增必填参数——不想改 140 个调用点。
 * 新增调用点请带 `"session.id"`（与 Effect 日志的字段约定一致）。
 */
function extractSessionID(fields: Record<string, unknown> | undefined): SessionID | undefined {
  if (!fields) return undefined
  const value = fields["session.id"] ?? fields.sessionID ?? fields.session_id
  if (typeof value !== "string" || value.length === 0) return undefined
  // 只做前缀校验，不走 SessionID.make：make 失败会抛异常，而这里是错误兜底路径。
  // 落库的 session_id 没有外键约束，脏值当没有会话即可，绝不因为它丢掉整条记录。
  return value.startsWith("ses") ? (value as SessionID) : undefined
}

/** 按 scope 记录错误；fields 会作为第二个参数输出，便于 grep/日志管道提取。 */
export function logError(scope: string, error: unknown, fields?: Record<string, unknown>): void {
  if (fields && Object.keys(fields).length > 0) {
    console.error(`[${scope}] ${format(error)}`, fields)
    // 控制台输出照旧；落库是可选增强，未注入 sink 时这里什么都不做。
    dispatchErrorAudit({ scope, message: format(error), sessionID: extractSessionID(fields), fields })
    return
  }
  console.error(`[${scope}] ${format(error)}`)
  dispatchErrorAudit({ scope, message: format(error) })
}

/** 同 logError，但用于降级/重试这类非致命路径，避免与错误混在一起。 */
export function logWarn(scope: string, message: string, fields?: Record<string, unknown>): void {
  if (fields && Object.keys(fields).length > 0) {
    console.warn(`[${scope}] ${message}`, fields)
    return
  }
  console.warn(`[${scope}] ${message}`)
}
