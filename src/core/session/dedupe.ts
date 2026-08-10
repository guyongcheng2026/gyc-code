/**
 * 会话列表展示去重：将完整对话内容相同的多条记录合并为一条，保留同项目内最新的一条。
 *
 * 算法：
 * 1. 从 SessionMessageTable 批量加载候选会话的全量消息（一条 SQL）
 * 2. 对每条会话，按 (session_id, seq) 升序遍历所有消息，拼接 "type:data_json\n"
 * 3. 用 SHA-256 计算规范化字符串的哈希值作为内容指纹
 * 4. 同项目内指纹相同的会话视为重复，保留 time_updated 最大的那条
 */
import { Database } from "../database/database"
import { SessionMessageTable } from "./sql"
import { inArray, asc } from "drizzle-orm"
import { createHash } from "node:crypto"
import type { SessionSchema } from "./schema"
import { Effect } from "effect"

/** list() 返回的会话记录至少需要的字段 */
export interface DedupSession {
  id: SessionSchema.ID
  projectID: string
}

/**
 * 从 list() 结果中去除对话内容相同的重复会话，保留同项目内 time_updated 最大者。
 *
 * @param db - 数据库实例
 * @param sessions - list() 返回的会话列表（需含 id、projectID）
 * @param timeUpdated - 从会话记录中提取 time_updated 数值的函数
 * @returns 去重后的会话列表（保持原顺序，仅移除重复项）
 */
export function dedupeByContent<T extends DedupSession>(
  db: Database.Interface["db"],
  sessions: T[],
  timeUpdated: (session: T) => number,
): Effect.Effect<T[], never> {
  return Effect.gen(function* () {
    if (sessions.length <= 1) return sessions

    // 按 projectID 分组
    const byProject = new Map<string, T[]>()
    for (const s of sessions) {
      const group = byProject.get(s.projectID) ?? []
      group.push(s)
      byProject.set(s.projectID, group)
    }

    const result: T[] = []

    for (const [, group] of byProject) {
      if (group.length <= 1) {
        result.push(...group)
        continue
      }

      const ids = group.map((s) => s.id)

      // 一条 SQL 批量加载所有候选会话的消息（按 session_id, seq 升序）
      const rows = yield* db
        .select({
          session_id: SessionMessageTable.session_id,
          seq: SessionMessageTable.seq,
          type: SessionMessageTable.type,
          data: SessionMessageTable.data,
        })
        .from(SessionMessageTable)
        .where(inArray(SessionMessageTable.session_id, ids))
        .orderBy(asc(SessionMessageTable.session_id), asc(SessionMessageTable.seq))
        .all()
        .pipe(Effect.orDie)

      // 按 session_id 分组
      const bySession = new Map<string, (typeof rows)[number][]>()
      for (const row of rows) {
        const arr = bySession.get(row.session_id) ?? []
        arr.push(row)
        bySession.set(row.session_id, arr)
      }

      // 计算每个会话的内容指纹
      const fingerprints = new Map<string, string[]>() // hash -> sessionIDs
      for (const sid of ids) {
        const msgs = bySession.get(sid) ?? []
        const canonical = msgs.map((m) => `${m.type}:${JSON.stringify(m.data)}`).join("\n")
        const hash = createHash("sha256").update(canonical).digest("hex")
        const arr = fingerprints.get(hash) ?? []
        arr.push(sid)
        fingerprints.set(hash, arr)
      }

      // 同一指纹内保留 time_updated 最大的会话
      for (const [, sids] of fingerprints) {
        if (sids.length <= 1) {
          result.push(group.find((s) => s.id === sids[0])!)
          continue
        }
        const candidates = sids.map((id) => group.find((s) => s.id === id)!)
        candidates.sort((a, b) => timeUpdated(b) - timeUpdated(a))
        result.push(candidates[0])
      }
    }

    // Restore chronological order: dedup groups by project which reorders the
    // original time-sorted list. Re-sort globally by timeUpdated DESC so both
    // server pagination cursors and CLI table display stay correct.
    result.sort((a, b) => timeUpdated(b) - timeUpdated(a))

    return result
  })
}
