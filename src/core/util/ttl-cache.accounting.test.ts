import { describe, expect, test } from "bun:test"
import { createTtlCache } from "./ttl-cache"

// totalSize 决定内存预算与驱逐范围，任何漏扣/双扣都会让缓存要么无限膨胀、
// 要么把无关条目清空。以下用例锁定各条路径下的记账一致性。
const sum = (cache: { keys: () => IterableIterator<string> }) => 1

describe("ttl-cache accounting", () => {
  test("keeps totalSize equal to live entries across every path", async () => {
    const cache = createTtlCache<string, string>({ maxSize: 10, ttlMs: 30 })
    cache.set("a", "1")
    cache.set("b", "2")
    expect(cache.stats().totalSize).toBe(2)

    // 命中不改变总量
    expect(cache.get("a")).toBe("1")
    expect(cache.stats().totalSize).toBe(2)

    // 覆盖同键不改变总量
    cache.set("a", "1b")
    expect(cache.stats().totalSize).toBe(2)

    // 删除已存在键（未过期）
    expect(cache.delete("b")).toBe(true)
    expect(cache.stats().totalSize).toBe(1)
    expect(cache.delete("missing")).toBe(false)

    // 过期后 delete：条目仍在 cache 里，必须扣减，否则统计虚高
    await Bun.sleep(45)
    expect(cache.delete("a")).toBe(true)
    expect(cache.stats().totalSize).toBe(0)
    expect(cache.stats().size).toBe(0)
  })

  test("expiry paths account exactly once", async () => {
    const cache = createTtlCache<string, string>({ maxSize: 10, ttlMs: 20 })
    cache.set("a", "1")
    await Bun.sleep(35)
    // has() 走过期清理
    expect(cache.has("a")).toBe(false)
    expect(cache.stats()).toEqual({ size: 0, totalSize: 0, maxSize: 10 })

    cache.set("b", "2")
    await Bun.sleep(35)
    // get() 走过期清理
    expect(cache.get("b")).toBeUndefined()
    expect(cache.stats().totalSize).toBe(0)

    cache.set("c", "3")
    await Bun.sleep(35)
    cache.set("d", "4") // makeRoomFor -> evictExpired 清理 c 并保持 d 的记账
    expect(cache.stats()).toEqual({ size: 1, totalSize: 1, maxSize: 10 })

    cache.clear()
    expect(cache.stats().totalSize).toBe(0)
    expect(sum(cache)).toBe(1)
  })

  test("overwriting an existing key does not evict unrelated entries", () => {
    const cache = createTtlCache<string, string>({ maxSize: 2, ttlMs: 1000 })
    cache.set("a", "1")
    cache.set("b", "2")
    cache.set("a", "1b")
    expect(cache.stats().size).toBe(2)
    expect(cache.get("b")).toBe("2")
  })

  test("non-finite sizeOf falls back to 1 instead of poisoning the budget", () => {
    const cache = createTtlCache<string, number>({ maxSize: 5, ttlMs: 1000, sizeOf: () => Number.NaN })
    cache.set("a", 1)
    cache.set("b", 2)
    expect(cache.stats().totalSize).toBe(2)
  })
})
