export * as SessionSearch from "./session-search"

import type { Database, SQLQueryBindings } from "bun:sqlite"
import { TRIGRAM_MIN_LENGTH, toFtsPhrase } from "./session-search-index"

/**
 * 历史会话内容检索。
 *
 * 两条路径：
 *   - FTS5（trigram 分词）——首选。影子表 `part_text` 承载 `part.data` 里抽出的
 *     可见文本，`part_fts` 是它的 external-content 索引。trigram 对任意长度 ≥3 的
 *     子串都能命中，中文同理，这正是当初 LIKE 全表扫要解决的问题。
 *   - LIKE 全表扫——回退。查询短于 3 字、索引尚未建（老库未迁移）、或 FTS 报错时
 *     都走这条，保证功能不因缺少索引而失效。
 *
 * 两条路径返回同一套字段与同一种排序：先按相关度（命中次数多、首次出现靠前），
 * 相关度完全相同时才回落到时间倒序、同时间按 part id 升序。
 */
export interface Input {
  query: string
  sessionID?: string
  limit?: number
}

export interface Result {
  session_id: string
  session_title: string
  message_id: string
  part_id: string
  snippet: string
  time_created: number
}

const DEFAULT_LIMIT = 20
const MAX_LIMIT = 100

/** Escape LIKE wildcards so user input matches literally. */
export const escapeLike = (value: string): string => value.replace(/[\\%_]/g, "\\$&")

/** 按码点计数：中文一个字算一个，避免用 UTF-16 长度误判。 */
function codepointLength(value: string): number {
  return [...value].length
}

function clampLimit(limit: number | undefined): number {
  return Math.min(Math.max(Math.trunc(limit ?? DEFAULT_LIMIT), 1), MAX_LIMIT)
}

function asResults(rows: unknown): Result[] {
  return (rows ?? []) as Result[]
}

/**
 * 相关度排序子句：命中次数多 → 首次出现靠前 → 时间倒序 → part id 升序。
 *
 * 直接在 SQL 里排序，而不是「先取 limit 条再在 JS 里重排」——后者会先把时间最新的
 * N 条截断，命中质量更高的老结果根本进不了候选池（缺口 P1-2：此前只按时间倒序）。
 * 两个 `?` 依次绑定**原始 query**（不转义、不加引号），因为 REPLACE/INSTR 做的是字面匹配。
 */
function relevanceOrder(text: string): string {
  return `ORDER BY (LENGTH(${text}) - LENGTH(REPLACE(${text}, ?, ''))) DESC,
            INSTR(${text}, ?) ASC,
            m.time_created DESC`
}

function searchViaLike(db: Database, query: string, sessionID: string | undefined, limit: number): Result[] {
  const statement = db.query(`
    SELECT p.session_id AS session_id,
           COALESCE(s.title, '') AS session_title,
           p.message_id AS message_id,
           p.id AS part_id,
           substr(json_extract(p.data, '$.text'), 1, 240) AS snippet,
           m.time_created AS time_created
      FROM part p
      JOIN message m ON m.id = p.message_id
      LEFT JOIN session s ON s.id = p.session_id
     WHERE json_extract(p.data, '$.type') = 'text'
       AND json_extract(p.data, '$.text') LIKE '%' || ? || '%' ESCAPE '\\'
       ${sessionID ? "AND p.session_id = ?" : ""}
     ${relevanceOrder("json_extract(p.data, '$.text')")}, p.id ASC
     LIMIT ?
  `)
  ;(statement as { safeIntegers?: (v: boolean) => unknown }).safeIntegers?.(false)

  const params: SQLQueryBindings[] = [escapeLike(query)]
  if (sessionID) params.push(sessionID)
  params.push(query, query, limit)

  return asResults(statement.all(...params))
}

function searchViaFts(db: Database, query: string, sessionID: string | undefined, limit: number): Result[] {
  const statement = db.query(`
    SELECT pt.session_id AS session_id,
           COALESCE(s.title, '') AS session_title,
           pt.message_id AS message_id,
           pt.id AS part_id,
           substr(pt.text, 1, 240) AS snippet,
           m.time_created AS time_created
      FROM part_fts f
      JOIN part_text pt ON pt.rowid = f.rowid
      JOIN message m ON m.id = pt.message_id
      LEFT JOIN session s ON s.id = pt.session_id
     WHERE part_fts MATCH ?
       ${sessionID ? "AND pt.session_id = ?" : ""}
     ${relevanceOrder("pt.text")}, pt.id ASC
     LIMIT ?
  `)
  ;(statement as { safeIntegers?: (v: boolean) => unknown }).safeIntegers?.(false)

  const params: SQLQueryBindings[] = [toFtsPhrase(query)]
  if (sessionID) params.push(sessionID)
  params.push(query, query, limit)

  return asResults(statement.all(...params))
}

export function search(db: Database, input: Input): Result[] {
  const query = input.query.trim()
  if (!query) return []
  const limit = clampLimit(input.limit)

  if (codepointLength(query) >= TRIGRAM_MIN_LENGTH) {
    try {
      return searchViaFts(db, query, input.sessionID, limit)
    } catch {
      // 索引尚未建（老库未迁移）或 FTS 不可用：退回 LIKE，检索功能绝不因此报错。
    }
  }

  return searchViaLike(db, query, input.sessionID, limit)
}
