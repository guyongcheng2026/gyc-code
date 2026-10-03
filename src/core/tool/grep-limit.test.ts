import { describe, expect, test } from "bun:test"
import { DEFAULT_MATCH_LIMIT, GrepTool } from "./grep"

describe("GrepTool 命中数上限", () => {
  test("未传 limit 时回落到默认上限，而不是无上限", () => {
    expect(GrepTool.resolveMatchLimit(undefined)).toBe(DEFAULT_MATCH_LIMIT)
  })

  test("默认上限与模型侧 MATCH_LIMIT 同量级（100）", () => {
    expect(DEFAULT_MATCH_LIMIT).toBe(100)
  })

  test("默认上限必须远小于 Number.MAX_SAFE_INTEGER（缺口 G-27-2）", () => {
    expect(GrepTool.resolveMatchLimit(undefined)).toBeLessThan(Number.MAX_SAFE_INTEGER)
  })

  test("显式传入的 limit 原样使用", () => {
    expect(GrepTool.resolveMatchLimit(7)).toBe(7)
    expect(GrepTool.resolveMatchLimit(5000)).toBe(5000)
  })

  test("非正数/非有限的 limit 回落到默认上限", () => {
    expect(GrepTool.resolveMatchLimit(0)).toBe(DEFAULT_MATCH_LIMIT)
    expect(GrepTool.resolveMatchLimit(-5)).toBe(DEFAULT_MATCH_LIMIT)
    expect(GrepTool.resolveMatchLimit(Number.NaN)).toBe(DEFAULT_MATCH_LIMIT)
    expect(GrepTool.resolveMatchLimit(Number.POSITIVE_INFINITY)).toBe(DEFAULT_MATCH_LIMIT)
  })
})