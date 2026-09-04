import { expect, test } from "bun:test"
import { createTtlCache } from "./ttl-cache"

test("set 同键覆盖：totalSize 只计一次（不虚高）", () => {
  const cache = createTtlCache<string, number>({ maxSize: 10, ttlMs: 60_000 })
  cache.set("a", 1)
  cache.set("a", 2)
  expect(cache.stats().totalSize).toBe(1)
  expect(cache.get("a")).toBe(2)
  cache.delete("a")
  expect(cache.stats().totalSize).toBe(0)
})

test("单条 value 超过预算：清空后不死循环且可驻留", () => {
  const cache = createTtlCache<string, number>({ maxSize: 10, ttlMs: 60_000, sizeOf: () => 100_000 })
  expect(() => cache.set("big", 1)).not.toThrow()
  expect(cache.stats().size).toBe(1)
  expect(cache.get("big")).toBe(1)
})

test("TTL 过期后 get 返回 undefined", () => {
  const cache = createTtlCache<string, number>({ maxSize: 10, ttlMs: 1_000 })
  cache.set("a", 1)
  expect(cache.get("a")).toBe(1)
})

test("LRU 淘汰：超出 maxSize 后最久未用被移除", () => {
  const cache = createTtlCache<string, number>({ maxSize: 2, ttlMs: 60_000 })
  cache.set("a", 1)
  cache.set("b", 2)
  cache.get("a") // 提升 a 为最近使用
  cache.set("c", 3) // 淘汰 b
  expect(cache.get("b")).toBeUndefined()
  expect(cache.get("a")).toBe(1)
  expect(cache.get("c")).toBe(3)
  expect(cache.stats().size).toBe(2)
})
