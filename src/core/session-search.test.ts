import { describe, expect, test } from "bun:test"
import type { Database } from "bun:sqlite"
import { Database as SqliteDatabase } from "bun:sqlite"
import { SessionSearch } from "./session-search"

function makeDb(): Database {
  const db = new SqliteDatabase(":memory:")
  db.run(`CREATE TABLE session (
    id TEXT PRIMARY KEY, title TEXT NOT NULL DEFAULT ''
  )`)
  db.run(`CREATE TABLE message (
    id TEXT PRIMARY KEY, session_id TEXT NOT NULL, time_created INTEGER NOT NULL
  )`)
  db.run(`CREATE TABLE part (
    id TEXT PRIMARY KEY, message_id TEXT NOT NULL, session_id TEXT NOT NULL, data TEXT NOT NULL
  )`)
  return db
}

function seed(
  db: Database,
  rows: {
    session?: { id: string; title: string }
    message?: { id: string; sessionId: string; timeCreated: number }
    part?: { id: string; messageId: string; sessionId: string; data: unknown }
  }[],
) {
  for (const row of rows) {
    if (row.session)
      db.query("INSERT INTO session (id, title) VALUES (?, ?)").run(row.session.id, row.session.title)
    if (row.message)
      db.query("INSERT INTO message (id, session_id, time_created) VALUES (?, ?, ?)").run(
        row.message.id,
        row.message.sessionId,
        row.message.timeCreated,
      )
    if (row.part)
      db.query("INSERT INTO part (id, message_id, session_id, data) VALUES (?, ?, ?, ?)").run(
        row.part.id,
        row.part.messageId,
        row.part.sessionId,
        JSON.stringify(row.part.data),
      )
  }
}

const textPart = (text: string) => ({ type: "text", text })

describe("SessionSearch.search", () => {
  test("中文子串命中并返回会话标题与摘要", () => {
    const db = makeDb()
    seed(db, [
      { session: { id: "s1", title: "性能优化会话" }, message: { id: "m1", sessionId: "s1", timeCreated: 100 }, part: { id: "p1", messageId: "m1", sessionId: "s1", data: textPart("讨论 ETag 缓存策略与骨架屏") } },
      { session: { id: "s2", title: "无关会话" }, message: { id: "m2", sessionId: "s2", timeCreated: 200 }, part: { id: "p2", messageId: "m2", sessionId: "s2", data: textPart("今天天气不错") } },
    ])
    const results = SessionSearch.search(db, { query: "ETag" })
    expect(results.length).toBe(1)
    const first = results[0]
    if (first === undefined) throw new Error("fixture missing: results[0]")
    expect(first.session_id).toBe("s1")
    expect(first.session_title).toBe("性能优化会话")
    expect(first.snippet).toContain("ETag")
  })

  test("英文查询大小写不敏感", () => {
    const db = makeDb()
    seed(db, [
      { message: { id: "m1", sessionId: "s1", timeCreated: 1 }, part: { id: "p1", messageId: "m1", sessionId: "s1", data: textPart("Run BUN TEST now") } },
    ])
    const results = SessionSearch.search(db, { query: "bun test" })
    expect(results.length).toBe(1)
  })

  test("LIKE 通配符按字面量处理（% 与 _ 转义）", () => {
    const db = makeDb()
    seed(db, [
      { message: { id: "m1", sessionId: "s1", timeCreated: 1 }, part: { id: "p1", messageId: "m1", sessionId: "s1", data: textPart("满减门槛是 50% 且编号 A_1") } },
      { message: { id: "m2", sessionId: "s1", timeCreated: 2 }, part: { id: "p2", messageId: "m2", sessionId: "s1", data: textPart("编号 AX1 无关内容") } },
    ])
    // "A_1" 应只命中字面包含下划线的第一条，而不是把 AX1 当通配匹配
    const results = SessionSearch.search(db, { query: "A_1" })
    expect(results.length).toBe(1)
    const hit = results[0]
    if (hit === undefined) throw new Error("fixture missing: results[0]")
    expect(hit.part_id).toBe("p1")
    // "%" 同理只命中字面百分号
    const pct = SessionSearch.search(db, { query: "50%" })
    expect(pct.length).toBe(1)
    const pctHit = pct[0]
    if (pctHit === undefined) throw new Error("fixture missing: pct[0]")
    expect(pctHit.part_id).toBe("p1")
  })

  test("非 text 类型部件不参与检索", () => {
    const db = makeDb()
    seed(db, [
      { message: { id: "m1", sessionId: "s1", timeCreated: 1 }, part: { id: "p1", messageId: "m1", sessionId: "s1", data: { type: "tool-invocation", toolName: "bash", state: { input: "ETAG" } } } },
    ])
    expect(SessionSearch.search(db, { query: "ETAG" }).length).toBe(0)
  })

  test("sessionID 过滤与 limit、时间倒序排序", () => {
    const db = makeDb()
    seed(db, [
      { message: { id: "m1", sessionId: "s1", timeCreated: 10 }, part: { id: "p1", messageId: "m1", sessionId: "s1", data: textPart("关键词甲") } },
      { message: { id: "m2", sessionId: "s1", timeCreated: 30 }, part: { id: "p2", messageId: "m2", sessionId: "s1", data: textPart("关键词乙") } },
      { message: { id: "m3", sessionId: "s2", timeCreated: 99 }, part: { id: "p3", messageId: "m3", sessionId: "s2", data: textPart("关键词丙") } },
    ])
    const only = SessionSearch.search(db, { query: "关键词", sessionID: "s1" })
    expect(only.map((r) => r.part_id)).toEqual(["p2", "p1"]) // 时间倒序
    const limited = SessionSearch.search(db, { query: "关键词", limit: 1 })
    expect(limited.length).toBe(1)
    const newest = limited[0]
    if (newest === undefined) throw new Error("fixture missing: limited[0]")
    expect(newest.time_created).toBe(99) // 跨会话也取最新
  })

  test("空白查询返回空数组且不抛错", () => {
    const db = makeDb()
    expect(SessionSearch.search(db, { query: "   " })).toEqual([])
  })
})

describe("SessionSearch.search · 相关度排序", () => {
  // 「缓存」只有 2 个码点，走 LIKE 回退路径，这里同时覆盖回退路径的排序。
  const strong = "缓存策略讨论：缓存命中、缓存刷新、缓存预热都围绕缓存展开"
  const weak = "今天只聊了天气，末尾顺口提一句缓存"

  test("命中更多且更早出现的结果排在时间更新的弱命中之前", () => {
    const db = makeDb()
    seed(db, [
      // 旧但强相关：命中 4 次，首次出现在开头
      { message: { id: "m1", sessionId: "s1", timeCreated: 10 }, part: { id: "p1", messageId: "m1", sessionId: "s1", data: textPart(strong) } },
      // 新但弱相关：只命中 1 次，且出现在末尾
      { message: { id: "m2", sessionId: "s1", timeCreated: 99 }, part: { id: "p2", messageId: "m2", sessionId: "s1", data: textPart(weak) } },
    ])

    expect(SessionSearch.search(db, { query: "缓存" }).map((r) => r.part_id)).toEqual(["p1", "p2"])
  })

  test("命中次数相同时，首次命中位置更靠前的排前面", () => {
    const db = makeDb()
    seed(db, [
      { message: { id: "m1", sessionId: "s1", timeCreated: 10 }, part: { id: "p1", messageId: "m1", sessionId: "s1", data: textPart("后面才提到缓存，仅此一次") } },
      { message: { id: "m2", sessionId: "s1", timeCreated: 99 }, part: { id: "p2", messageId: "m2", sessionId: "s1", data: textPart("缓存就是这次的核心，仅此一次") } },
    ])

    expect(SessionSearch.search(db, { query: "缓存" }).map((r) => r.part_id)).toEqual(["p2", "p1"])
  })

  test("limit 在排序之后生效：被截断留下的是最相关的而不是最新的", () => {
    const db = makeDb()
    seed(db, [
      { message: { id: "m1", sessionId: "s1", timeCreated: 10 }, part: { id: "p1", messageId: "m1", sessionId: "s1", data: textPart(strong) } },
      { message: { id: "m2", sessionId: "s1", timeCreated: 99 }, part: { id: "p2", messageId: "m2", sessionId: "s1", data: textPart(weak) } },
    ])

    expect(SessionSearch.search(db, { query: "缓存", limit: 1 }).map((r) => r.part_id)).toEqual(["p1"])
  })

  test("相关度完全相同时仍回落到时间倒序，保证结果稳定", () => {
    const db = makeDb()
    seed(db, [
      { message: { id: "m1", sessionId: "s1", timeCreated: 10 }, part: { id: "p1", messageId: "m1", sessionId: "s1", data: textPart("关键词甲") } },
      { message: { id: "m2", sessionId: "s1", timeCreated: 30 }, part: { id: "p2", messageId: "m2", sessionId: "s1", data: textPart("关键词乙") } },
    ])

    expect(SessionSearch.search(db, { query: "关键词" }).map((r) => r.part_id)).toEqual(["p2", "p1"])
  })
})
