import { describe, expect, test } from "bun:test"
import { DEFECT_PATTERNS, formatDefectMatches, matchDefectPatterns } from "./defect-patterns"

describe("defect-patterns 审查模式匹配", () => {
  test("模式库结构完整：ID 唯一、级别合法、关键词非空", () => {
    expect(DEFECT_PATTERNS.length).toBeGreaterThanOrEqual(25)
    const ids = new Set<string>()
    for (const p of DEFECT_PATTERNS) {
      expect([1, 2, 3]).toContain(p.level)
      expect(p.keywords.length).toBeGreaterThan(0)
      expect(ids.has(p.id)).toBe(false)
      ids.add(p.id)
      expect(p.name.length).toBeGreaterThan(0)
      expect(p.fix.length).toBeGreaterThan(0)
    }
  })

  test("命中读-改-写并发丢失模式", () => {
    const matches = matchDefectPatterns("两个 set 并发时后写者覆盖前者，读-改-写无锁导致丢失更新")
    expect(matches.length).toBeGreaterThan(0)
    expect(matches[0].pattern.id).toBe("P1-RMW-UNSAFE")
    expect(matches[0].hits.length).toBeGreaterThan(0)
  })

  test("命中跨会话越权模式", () => {
    const matches = matchDefectPatterns("reply 端点凭 requestID 即可跨会话审批，缺归属校验")
    expect(matches.some((m) => m.pattern.id === "P1-CROSS-SESSION")).toBe(true)
  })

  test("命中静默吞错模式", () => {
    const matches = matchDefectPatterns("catch 后仅 logWarning 就降级返回 undefined，失败被静默吞掉")
    expect(matches.some((m) => m.pattern.id === "P2-SILENT-FAIL")).toBe(true)
  })

  test("无匹配返回空数组，格式化返回 undefined", () => {
    expect(matchDefectPatterns("今天天气不错")).toEqual([])
    expect(formatDefectMatches([])).toBeUndefined()
  })

  test("格式化输出带 ID 与级别标签", () => {
    const matches = matchDefectPatterns("orDie 处理正则编译失败直通 500")
    const text = formatDefectMatches(matches)
    expect(text).toBeDefined()
    expect(text).toContain("known-defect-patterns")
    expect(text).toMatch(/\[P\d-[A-Z0-9-]+\|[123]级\]/)
  })

  test("多命中按命中数降序", () => {
    const matches = matchDefectPatterns("模块级全局可变状态且读-改-写无锁，覆盖竞态丢失更新")
    expect(matches.length).toBeGreaterThanOrEqual(2)
    for (let i = 1; i < matches.length; i++) {
      expect(matches[i - 1].hits.length).toBeGreaterThanOrEqual(matches[i].hits.length)
    }
  })
})
