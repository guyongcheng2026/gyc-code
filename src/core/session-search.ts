export * as SessionSearch from "./session-search"

import type { Database, SQLQueryBindings } from "bun:sqlite"

/**
 * Phase-0 full-text-ish search over historical session content.
 *
 * Scans `part.data` (JSON) for `type === "text"` parts whose `$.text`
 * contains the given substring, newest first. Uses LIKE with escaped
 * wildcards so user input matches literally; ASCII matching is
 * case-insensitive (SQLite LIKE semantics), CJK matches by exact substring.
 *
 * Phase-1 will replace this scan with an FTS5 trigram index.
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

export function search(db: Database, input: Input): Result[] {
  const query = input.query.trim()
  if (!query) return []
  const limit = Math.min(Math.max(Math.trunc(input.limit ?? DEFAULT_LIMIT), 1), MAX_LIMIT)

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
       ${input.sessionID ? "AND p.session_id = ?" : ""}
     ORDER BY m.time_created DESC, p.id ASC
     LIMIT ?
  `)
  ;(statement as { safeIntegers?: (v: boolean) => unknown }).safeIntegers?.(false)

  const params: SQLQueryBindings[] = [escapeLike(query)]
  if (input.sessionID) params.push(input.sessionID)
  params.push(limit)

  return (statement.all(...params) ?? []) as unknown as Result[]
}
