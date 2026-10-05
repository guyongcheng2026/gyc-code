import { describe, expect, it } from "bun:test"
import { cachedRegex } from "./regex-cache"

describe("cachedRegex", () => {
  it("returns the same RegExp instance for the same pattern and flags", () => {
    expect(cachedRegex("^a+$", "g")).toBe(cachedRegex("^a+$", "g"))
  })

  it("returns different instances for different flags", () => {
    expect(cachedRegex("^a+$", "g")).not.toBe(cachedRegex("^a+$", "i"))
  })

  it("returns different instances for different patterns", () => {
    expect(cachedRegex("^a+$", "g")).not.toBe(cachedRegex("^b+$", "g"))
  })

  it("resets lastIndex before use so /g is not stateful across calls", () => {
    // 不复位时：第一次 test 把 lastIndex 推到 1，第二次从 1 起匹配会失败
    expect(cachedRegex("\\d", "g").test("a1")).toBe(true)
    expect(cachedRegex("\\d", "g").test("a1")).toBe(true)
    expect(cachedRegex("\\d", "g").test("a1")).toBe(true)
  })

  it("treats a missing flags argument as empty flags", () => {
    expect(cachedRegex("abc")).toBe(cachedRegex("abc", ""))
  })

  it("does not collide across flag/pattern boundaries", () => {
    // key 用分隔符拼接：若无分隔符，"g"+"\0a" 与 "g\0"+"a" 会撞成同一条
    expect(cachedRegex("a", "g")).not.toBe(cachedRegex("\u0000a", "g"))
    // flags "g" 与 "i" 拼接后与 pattern "gi" 在无分隔符时会撞车
    expect(cachedRegex("i", "g")).not.toBe(cachedRegex("", "gi"))
  })

  it("bounds the cache and stays functional after eviction", () => {
    const before = cachedRegex.cacheSize()
    for (let i = 0; i < 600; i++) cachedRegex(`pattern-${i}`, "g")
    expect(cachedRegex.cacheSize()).toBeLessThanOrEqual(cachedRegex.CACHE_LIMIT)
    // 清空后仍要能重新编译并正确匹配
    expect(cachedRegex("^zzz$", "g").test("zzz")).toBe(true)
    expect(before).toBeGreaterThanOrEqual(0)
  })

  it("still honours non-global flags without state leakage", () => {
    const re = cachedRegex("^a", "i")
    expect(re.test("AAA")).toBe(true)
    expect(re.test("AAA")).toBe(true)
  })
})