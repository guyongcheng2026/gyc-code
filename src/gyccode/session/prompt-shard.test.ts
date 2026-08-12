import { describe, expect, it } from "bun:test"
import { ShardCache, hashShard, ShardTier } from "./prompt-shard"

describe("hashShard", () => {
  it("is deterministic for identical content", () => {
    expect(hashShard("hello world")).toBe(hashShard("hello world"))
  })

  it("differs for different content", () => {
    expect(hashShard("hello")).not.toBe(hashShard("world"))
  })

  it("returns a hex string", () => {
    expect(hashShard("any content")).toMatch(/^[0-9a-f]+$/)
  })
})

describe("ShardCache", () => {
  it("stores and retrieves by tier", () => {
    const cache = new ShardCache()
    const shard = { tier: "static" as ShardTier, content: "abc", hash: hashShard("abc") }
    cache.set(shard)
    expect(cache.get("static")?.content).toBe("abc")
  })

  it("returns undefined for a missing tier", () => {
    const cache = new ShardCache()
    expect(cache.get("semi")).toBeUndefined()
  })

  it("keeps segments on the shard", () => {
    const cache = new ShardCache()
    const shard = { tier: "semi" as ShardTier, content: "a", hash: hashShard("a"), segments: ["a"] }
    cache.set(shard)
    expect(cache.get("semi")?.segments).toEqual(["a"])
  })

  it("invalidates a single tier", () => {
    const cache = new ShardCache()
    cache.set({ tier: "static" as ShardTier, content: "a", hash: hashShard("a") })
    cache.set({ tier: "semi" as ShardTier, content: "b", hash: hashShard("b") })
    cache.invalidate("static")
    expect(cache.get("static")).toBeUndefined()
    expect(cache.get("semi")).toBeDefined()
  })

  it("invalidates all tiers without a tier arg", () => {
    const cache = new ShardCache()
    cache.set({ tier: "static" as ShardTier, content: "a", hash: hashShard("a") })
    cache.set({ tier: "semi" as ShardTier, content: "b", hash: hashShard("b") })
    cache.invalidate()
    expect(cache.get("static")).toBeUndefined()
    expect(cache.get("semi")).toBeUndefined()
  })

  it("buildPrompt joins tiers in static, semi, dynamic order", () => {
    const cache = new ShardCache()
    cache.set({ tier: "dynamic" as ShardTier, content: "dyn", hash: hashShard("dyn") })
    cache.set({ tier: "static" as ShardTier, content: "stat", hash: hashShard("stat") })
    cache.set({ tier: "semi" as ShardTier, content: "semi", hash: hashShard("semi") })
    expect(cache.buildPrompt()).toBe("stat\n\nsemi\n\ndyn")
  })

  it("buildSystem returns parts in static, semi, dynamic order", () => {
    const cache = new ShardCache()
    cache.set({ tier: "static" as ShardTier, content: "stat", hash: hashShard("stat") })
    cache.set({ tier: "semi" as ShardTier, content: "semi", hash: hashShard("semi"), segments: ["semi-a", "semi-b"] })
    cache.set({ tier: "dynamic" as ShardTier, content: "dyn", hash: hashShard("dyn"), segments: ["dyn-a"] })
    expect(cache.buildSystem()).toEqual(["stat", "semi-a", "semi-b", "dyn-a"])
  })

  it("buildSystem appends extras after the shard tiers", () => {
    const cache = new ShardCache()
    cache.set({ tier: "static" as ShardTier, content: "stat", hash: hashShard("stat") })
    expect(cache.buildSystem(["memories", "structured"])).toEqual(["stat", "memories", "structured"])
  })

  it("buildSystem skips empty shards and empty segments", () => {
    const cache = new ShardCache()
    cache.set({ tier: "static" as ShardTier, content: "", hash: hashShard("") })
    cache.set({ tier: "semi" as ShardTier, content: "", hash: hashShard(""), segments: [] })
    expect(cache.buildSystem(["extra"])).toEqual(["extra"])
  })
})