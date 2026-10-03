/**
 * logError 的结构化落库旁路。
 *
 * 控制台输出不持久、也不带会话维度：进程一关就没法回答「昨晚那批失败到底是哪些
 * scope」。这里提供一份可注入的写入函数，把 scope / message / session / fields
 * 追加进 error_audit 表。
 *
 * 三条硬约束（都是为了不让「记录错误」本身变成新的故障源）：
 * 1. 数据库不可用时静默跳过——错误日志是兜底路径，不能反过来把调用方拖挂。
 * 2. 写入失败降级为 debug 日志，绝不抛。
 * 3. 非法 fields（比如循环引用）不能让整个 logError 调用炸掉。
 */

import { randomUUID } from "node:crypto"
import { Effect } from "effect"
import { Database } from "../database/database"
import { ErrorAuditTable } from "../session/sql"
import type { SessionSchema } from "../session/schema"

export interface ErrorAuditRecord {
  scope: string
  message: string
  /** 可空：进程级错误（CLI 启动、配置加载）没有会话。 */
  sessionID?: SessionSchema.ID | undefined
  fields?: Record<string, unknown> | undefined
}

/**
 * fields 序列化成 JSON 列。循环引用 / BigInt 这类不能 JSON.stringify 的值会被
 * 整体替换为占位说明——宁可丢字段，也不要因为一条日志的附加信息抛异常。
 */
function encodeFields(fields: Record<string, unknown> | undefined): Record<string, unknown> | undefined {
  if (!fields || Object.keys(fields).length === 0) return undefined
  try {
    JSON.parse(JSON.stringify(fields))
    return fields
  } catch {
    return { __unserializable: "fields 无法序列化，已省略" }
  }
}

/**
 * 把一条错误写入 error_audit。数据库不可用则静默跳过，写入失败只记 debug。
 *
 * 单独导出而不是内联进 logError，是为了让核心层不必知道数据库的存在：
 * 应用启动时（能拿到 Database.Service 的地方）调用 setErrorAuditSink 注入即可，
 * 未注入时 logError 行为与改动前完全一致。
 */
export const writeErrorAudit = (record: ErrorAuditRecord) =>
  Effect.gen(function* () {
    const { db } = yield* Database.Service
    yield* db
      .insert(ErrorAuditTable)
      .values({
        // 这张表没有专用 ID 前缀（按 scope/时间查询，不需要有序 ID），
        // 用 UUID 避免为了一个主键去动 id.ts 的前缀表。
        id: randomUUID(),
        session_id: record.sessionID ?? null,
        scope: record.scope,
        message: record.message,
        fields: encodeFields(record.fields) ?? null,
      })
      .run()
  }).pipe(
    // 数据库没开（CLI 早期、测试、单次命令）或写入本身出错时，一律静默跳过。
    // catchCause 同时覆盖 typed failure 与 defect，这里不需要再补 catchAllDefect：
    // 记录错误本身绝不能成为新的故障源。
    Effect.catchCause((cause) => Effect.logDebug("error_audit 写入跳过", { cause })),
    Effect.asVoid,
  )

let sink: ((record: ErrorAuditRecord) => void) | undefined

/** 应用启动时注入落库通道；传 undefined 取消（测试隔离用）。 */
export function setErrorAuditSink(next: ((record: ErrorAuditRecord) => void) | undefined) {
  sink = next
}

/** 当前是否已接入落库。测试可据此断言接线状态。 */
export const hasErrorAuditSink = () => sink !== undefined

/**
 * 落库入口。sink 未注入或调用中抛错都不影响主流程——logError 永远先输出控制台，
 * 落库只是可选增强。这里用 queueMicrotask 让写库完全脱离调用栈，避免把
 * 「记一条错误」的耗时算到业务路径上。
 */
export function dispatchErrorAudit(record: ErrorAuditRecord) {
  const current = sink
  if (!current) return
  try {
    queueMicrotask(() => {
      try {
        current(record)
      } catch {
        // 落库通道自身失败：无处可去，也不该递归上报。
      }
    })
  } catch {
    // queueMicrotask 不可用（极老运行时）：静默放弃。
  }
}
