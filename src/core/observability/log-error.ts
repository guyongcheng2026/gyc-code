/**
 * 统一错误日志入口。
 *
 * 各处原先手写 `console.error(\`[tag] ... ${String(e)}\`)` 约 70 处，格式与字段
 * 各不相同：没有 sessionID/traceId 时，线上根本无法按会话聚合排查"某次请求为什么
 * 失败"。这里固定 scope 前缀并支持透传结构化字段，新增调用点一律走它。
 *
 * R-4：logWarn 此前只 console.warn、不落库，告警事后完全无法审计。现已与 logError
 * 共用 dispatchErrorAudit，级别承载方式见下面 LEVEL_FIELD 的说明。
 */

import type { SessionID } from "@gyccode/schema/session-id"
import { dispatchErrorAudit } from "./error-audit"

const format = (error: unknown): string =>
  error instanceof Error ? (error.stack ?? error.message) : String(error)

/**
 * 级别标记的字段名。
 *
 * 为什么寄生在 fields 里：`error_audit` 表只有 id / session_id / scope / message /
 * fields / time_created，没有 severity/level 列。加一列要同时动
 * error-audit-table.ts 的 DDL、增量迁移与 schema.gen.ts，还要回填历史数据，超出本轮
 * 范围。`fields` 是已有的 JSON 列，拿它承载级别是零 schema 改动的唯一干净做法。
 *
 * 取值约定：`logError` 不写这个键（落库内容与改动前逐字节一致），`logWarn` 恒定写
 * `level: "warn"`。于是「查全部告警」= `fields.level = 'warn'`，
 * 「`fields.level IS NULL`」= 改动前的错误记录，两类都不漏、也不会互相误判。
 *
 * 将来若要按级别做高频筛选或独立索引，应新建一列 `level` 并补一次增量迁移
 * （把现有 fields.level 回填进去），而不是继续在 JSON 里挖。
 */
const LEVEL_FIELD = "level"

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

/**
 * 同 logError，但用于降级/重试这类非致命路径，避免与错误混在一起。
 *
 * R-4：以前这里 console.warn 完就 return，告警只留在终端滚动缓冲里，进程一关就没了。
 * 现在同样走 dispatchErrorAudit。对外可观察行为保持不变：
 * - console.warn 的输出形态与改动前一致（level 只进落库记录，不混进控制台第二参数）；
 * - 未注册 sink 时 dispatchErrorAudit 内部立即 return，不产生任何落库副作用；
 * - sink 自身抛错被 dispatchErrorAudit 的 try/catch 吞掉，审计失败不拖挂主流程。
 *
 * fields 仍然保持可选，不改成必填参数：logWarn 26 处、logError 141 处调用点，一次性
 * 改签名会波及全部调用点，而且这些调用点常常确实没有会话上下文可传。
 * 代价是「无 fields 的告警」原本会因为 fields 为空而无从区分级别，所以这里无 fields
 * 时也构造 `{ level: "warn" }` 落库——宁可 fields 里只有级别标记，也绝不能丢记录。
 */
export function logWarn(scope: string, message: string, fields?: Record<string, unknown>): void {
  if (fields && Object.keys(fields).length > 0) {
    console.warn(`[${scope}] ${message}`, fields)
  } else {
    console.warn(`[${scope}] ${message}`)
  }
  // 复制一份而不是就地改调用方传进来的 fields：同一对象可能还被别处复用。
  // level 放在展开之后，保证调用点自己传的 level 不会盖掉真实级别。
  dispatchErrorAudit({
    scope,
    message,
    sessionID: extractSessionID(fields),
    fields: { ...fields, [LEVEL_FIELD]: "warn" },
  })
}