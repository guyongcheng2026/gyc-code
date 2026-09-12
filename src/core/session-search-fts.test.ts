import { describe, expect, test } from "bun:test"
import type { Database } from "bun:sqlite"
import { Database as SqliteDatabase } from "bun:sqlite"
import { SessionSearch } from "./session-search"
import { SESSION_SEARCH_INDEX_STATEMENTS, toFtsPhrase } from "./session-search-index"

const textPart = (text: string) => ({ type: "text", text })

/** 与生产库同构的最小 schema：只保留检索用到的列。 */
function makeDb(): Database {
  const db = new SqliteDatabase(":memory:")
  db.run(`CREATE TABLE session (id TEXT PRIMARY KEY, title TEXT NOT NULL DEFAULT '')`)
  db.run(`CREATE TABLE message (id TEXT PRIMARY KEY, session_id TEXT NOT NULL, time_created INTEGER NOT NULL)`)
  db.run(`CREATE TABLE part (id TEXT PRIMARY KEY, message_id TEXT NOT NULL, session_id TEXT NOT NULL, data TEXT NOT NULL)`)
  return db
}

/** 装上真实迁移里那套索引与触发器。 */
function withIndex(db: Database): Database {
  for (const statement of SESSION_SEARCH_INDEX_STATEMENTS) db.run(statement)
  return db
}

function addPart(
  db: Database,
  input: { partId: string; messageId: string; sessionId: string; timeCreated: number; text: string; title?: string },
): void {
  db.query("INSERT OR REPLACE INTO session (id, title) VALUES (?, ?)").run(input.sessionId, input.title ?? "")
  db.query("INSERT OR REPLACE INTO message (id, session_id, time_created) VALUES (?, ?, ?)").run(
    input.messageId,
    input.sessionId,
    input.timeCreated,
  )
  db.query("INSERT INTO part (id, message_id, session_id, data) VALUES (?, ?, ?, ?)").run(
    input.partId,
    input.messageId,
    input.sessionId,
    JSON.stringify(textPart(input.text)),
  )
}

describe("session-search · FTS5 路径", () => {
  test("建有索引时能命中中文子串", () => {
    const db = withIndex(makeDb())
    addPart(db, { partId: "p1", messageId: "m1", sessionId: "s1", timeCreated: 100, text: "本次修复了网关的缓存优化逻辑", title: "网关会话" })
    addPart(db, { partId: "p2", messageId: "m2", sessionId: "s2", timeCreated: 200, text: "无关内容" })

    const results = SessionSearch.search(db, { query: "缓存优化" })
    expect(results.length).toBe(1)
    expect(results[0]!.part_id).toBe("p1")
    expect(results[0]!.session_title).toBe("网关会话")
  })

  test("结果按时间倒序", () => {
    const db = withIndex(makeDb())
    addPart(db, { partId: "p1", messageId: "m1", sessionId: "s1", timeCreated: 10, text: "关键字甲" })
    addPart(db, { partId: "p2", messageId: "m2", sessionId: "s1", timeCreated: 30, text: "关键字乙" })
    addPart(db, { partId: "p3", messageId: "m3", sessionId: "s2", timeCreated: 99, text: "关键字丙" })

    expect(SessionSearch.search(db, { query: "关键字" }).map((r) => r.part_id)).toEqual(["p3", "p2", "p1"])
  })

  test("sessionID 过滤在 FTS 路径下同样生效", () => {
    const db = withIndex(makeDb())
    addPart(db, { partId: "p1", messageId: "m1", sessionId: "s1", timeCreated: 10, text: "关键字甲" })
    addPart(db, { partId: "p2", messageId: "m2", sessionId: "s2", timeCreated: 20, text: "关键字乙" })

    expect(SessionSearch.search(db, { query: "关键字", sessionID: "s1" }).map((r) => r.part_id)).toEqual(["p1"])
  })

  test("ASCII 查询大小写不敏感", () => {
    const db = withIndex(makeDb())
    addPart(db, { partId: "p1", messageId: "m1", sessionId: "s1", timeCreated: 1, text: "Run BUN TEST now" })
    expect(SessionSearch.search(db, { query: "bun test" }).length).toBe(1)
  })

  test("含 LIKE 通配符的查询在 FTS 路径下按字面量匹配", () => {
    const db = withIndex(makeDb())
    addPart(db, { partId: "p1", messageId: "m1", sessionId: "s1", timeCreated: 1, text: "命中率 50% 且标记 A_1" })
    addPart(db, { partId: "p2", messageId: "m2", sessionId: "s2", timeCreated: 2, text: "无关的 AX1 内容" })

    expect(SessionSearch.search(db, { query: "A_1" }).map((r) => r.part_id)).toEqual(["p1"])
    expect(SessionSearch.search(db, { query: "50%" }).map((r) => r.part_id)).toEqual(["p1"])
  })

  test("非 text 类型的 part 不进索引", () => {
    const db = withIndex(makeDb())
    db.query("INSERT INTO session (id, title) VALUES ('s1', '')").run()
    db.query("INSERT INTO message (id, session_id, time_created) VALUES ('m1', 's1', 1)").run()
    db.query("INSERT INTO part (id, message_id, session_id, data) VALUES ('p1', 'm1', 's1', ?)").run(
      JSON.stringify({ type: "tool-invocation", toolName: "bash", state: { input: "ETAG" } }),
    )

    expect(SessionSearch.search(db, { query: "ETAG" }).length).toBe(0)
  })
})

describe("session-search · 索引维护", () => {
  test("索引建好之后新增的 part 也能被搜到（触发器生效）", () => {
    const db = withIndex(makeDb())
    addPart(db, { partId: "p1", messageId: "m1", sessionId: "s1", timeCreated: 1, text: "初始内容" })

    addPart(db, { partId: "p2", messageId: "m2", sessionId: "s1", timeCreated: 2, text: "后续新增的雪崩保护" })

    expect(SessionSearch.search(db, { query: "雪崩保护" }).map((r) => r.part_id)).toEqual(["p2"])
  })

  test("删除 part 之后不再被搜到", () => {
    const db = withIndex(makeDb())
    addPart(db, { partId: "p1", messageId: "m1", sessionId: "s1", timeCreated: 1, text: "待删除的限流策略" })
    expect(SessionSearch.search(db, { query: "限流策略" }).length).toBe(1)

    db.query("DELETE FROM part WHERE id = 'p1'").run()
    expect(SessionSearch.search(db, { query: "限流策略" }).length).toBe(0)
  })

  test("part 文本被更新后索引跟着变", () => {
    const db = withIndex(makeDb())
    addPart(db, { partId: "p1", messageId: "m1", sessionId: "s1", timeCreated: 1, text: "旧的熔断策略" })

    db.query("UPDATE part SET data = ? WHERE id = 'p1'").run(JSON.stringify(textPart("新的降级策略")))

    expect(SessionSearch.search(db, { query: "旧的熔断" }).length).toBe(0)
    expect(SessionSearch.search(db, { query: "新的降级" }).map((r) => r.part_id)).toEqual(["p1"])
  })

  test("迁移语句可重复执行（幂等）", () => {
    const db = withIndex(makeDb())
    addPart(db, { partId: "p1", messageId: "m1", sessionId: "s1", timeCreated: 1, text: "重复迁移的索引重建" })
    expect(() => withIndex(db)).not.toThrow()
    expect(SessionSearch.search(db, { query: "重复迁移" }).length).toBe(1)
  })
})

describe("session-search · 回退路径", () => {
  test("索引缺失时回退 LIKE，不报错", () => {
    const db = makeDb()
    addPart(db, { partId: "p1", messageId: "m1", sessionId: "s1", timeCreated: 1, text: "没有索引也要能搜到这段内容" })
    expect(SessionSearch.search(db, { query: "也要能搜到" }).map((r) => r.part_id)).toEqual(["p1"])
  })

  test("短于 3 个码点的查询走 LIKE", () => {
    const db = withIndex(makeDb())
    addPart(db, { partId: "p1", messageId: "m1", sessionId: "s1", timeCreated: 1, text: "限流" })
    // "流" 只有 1 个码点，trigram 无法命中，必须靠 LIKE 回退
    expect(SessionSearch.search(db, { query: "流" }).map((r) => r.part_id)).toEqual(["p1"])
  })

  test("空白查询返回空且不抛错", () => {
    const db = makeDb()
    expect(SessionSearch.search(db, { query: "   " })).toEqual([])
  })
})

describe("toFtsPhrase", () => {
  test("包成双引号短语并转义内部双引号", () => {
    expect(toFtsPhrase("abc")).toBe('"abc"')
    expect(toFtsPhrase('a"b')).toBe('"a""b"')
  })
})
