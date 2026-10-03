import { describe, expect, test } from "bun:test"
import { readFileSync } from "node:fs"
import path from "node:path"
import { MATCH_LIMIT, emptyMatchNotice } from "./grep"

/**
 * H-04（幻觉率）：内容搜索零命中时，回执必须说清「内容没命中」而不是「没有文件」。
 *
 * 旧文案是 "No files found"，模型读成「这个目录下没有文件」，进而判定目标文件/API
 * 不存在并转而自己造一个。这里锁住语义与接线。
 */

describe("grep 零命中回执", () => {
  test("说明搜的是内容而非文件本身", () => {
    const notice = emptyMatchNotice("FooBar")
    expect(notice).toContain("No matches found for pattern /FooBar/")
    expect(notice).toContain("does not occur in any searched file's contents")
    expect(notice).not.toContain("No files found")
  })

  test("带 path 时回显搜索范围", () => {
    expect(emptyMatchNotice("FooBar", "src/core")).toContain("in src/core")
  })

  test("给出可行动的补救方向，并显式禁止据此断言符号不存在", () => {
    const notice = emptyMatchNotice("FooBar")
    expect(notice).toContain("widen the pattern")
    expect(notice).toContain("Do not conclude the symbol or file does not exist")
  })

  test("默认命中上限存在且远低于无上限（缺口 G-27-2）", () => {
    expect(MATCH_LIMIT).toBe(100)
    expect(MATCH_LIMIT).toBeLessThan(Number.MAX_SAFE_INTEGER)
  })

  test("接线未被摘掉：execute 仍使用 emptyMatchNotice", () => {
    const source = readFileSync(path.join(import.meta.dir, "grep.ts"), "utf8")
    expect(source).toContain("output: emptyMatchNotice(params.pattern, params.path)")
    // 旧文案只能留在历史说明注释里，不能再出现在真正返回给模型的位置
    expect(source).not.toMatch(/output:\s*[`"']No files found/)
  })

  test("命中结果按相关度输出而非 ripgrep 原始顺序（P1-2）", () => {
    const source = readFileSync(path.join(import.meta.dir, "grep.ts"), "utf8")
    // ranked 算完后必须真正进入输出循环，否则排序等于白做
    const loopAt = source.indexOf("for (const match of")
    expect(loopAt).toBeGreaterThan(-1)
    expect(source.slice(loopAt, loopAt + 40)).toContain("matches")
    expect(source).toContain("const matches = truncated ? ranked.slice(0, MATCH_LIMIT) : ranked")
  })
})
