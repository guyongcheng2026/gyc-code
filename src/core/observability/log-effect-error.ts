/**
 * 统一封装 Effect.logError 调用，强制字段名一致，便于审计表按字段聚合与索引。
 *
 * 各处原先手写 `{ error }` / `{ cause }` / `{ detail }` / `{ message }` 字段不统一，
 * 导致 error_audit 表的 fields 列难以按字段查询。新增调用点一律走本函数。
 *
 * @param scope 错误所属域，如 "session.llm"、"tool.shell"
 * @param message 人类可读的错误摘要
 * @param fields 结构化附加字段，建议只传基础类型（string/number/boolean），
 *               避免传入 Error 实例（无法 JSON 序列化进 fields 列）。
 * @param sessionID 可选，会话维度，用于按会话聚合错误。优先传入时直接使用，
 *                  否则从 fields["session.id"] 提取。
 */
import { Effect } from "effect"
import { dispatchErrorAudit } from "./error-audit"
import type { SessionSchema } from "../session/schema"

export function logEffectError(
  scope: string,
  message: string,
  fields?: Record<string, unknown>,
  sessionID?: SessionSchema.ID,
): void {
  const normalizedFields: Record<string, unknown> = { ...(fields ?? {}) }
  // 统一将会话维度写入 fields["session.id"]，便于 error-audit.ts 的 extractSessionID 提取。
  if (sessionID && !normalizedFields["session.id"]) {
    normalizedFields["session.id"] = sessionID
  }
  // 不把 Error 实例塞进 fields：writeErrorAudit 会 JSON.stringify fields，
  // Error 会被整体替换为占位，丢失堆栈信息。堆栈由 message 字段或 Effect.cause 承载。
  dispatchErrorAudit({
    scope,
    message,
    sessionID,
    fields: normalizedFields,
    level: "error",
  })
  // 同时输出控制台，保持开发时可见。
  console.error(`[${scope}] ${message}`, Object.keys(normalizedFields).length > 0 ? normalizedFields : undefined)
}
