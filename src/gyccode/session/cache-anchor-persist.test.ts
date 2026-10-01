import { describe, expect, test } from "bun:test"
import { ANCHOR_FILE, detectCacheDrift, loadCacheAnchors, persistCacheAnchors, trackCacheDrift } from "./cache-anchor"
import fs from "fs"
import path from "path"

describe("C-08 缓存锚点落盘与恢复", () => {
  test("锚点文件位置在 state 目录下", () => {
    expect(path.basename(ANCHOR_FILE)).toBe("cache-anchors.json")
  })

  test("文件不存在时安全返回空锚点，不抛异常", () => {
    expect(() => loadCacheAnchors()).not.toThrow()
  })

  test("损坏的锚点文件不阻断会话（锚点只是观测信号）", () => {
    const original = fs.existsSync(ANCHOR_FILE) ? fs.readFileSync(ANCHOR_FILE, "utf-8") : undefined
    try {
      fs.mkdirSync(path.dirname(ANCHOR_FILE), { recursive: true })
      fs.writeFileSync(ANCHOR_FILE, "{ 这不是 JSON", "utf-8")
      expect(loadCacheAnchors().size).toBe(0)
      fs.writeFileSync(ANCHOR_FILE, JSON.stringify({ ses_x: { cacheRead: "x", inputTokens: 1 } }), "utf-8")
      expect(loadCacheAnchors().size).toBe(0)
    } finally {
      if (original === undefined) fs.rmSync(ANCHOR_FILE, { force: true })
      else fs.writeFileSync(ANCHOR_FILE, original, "utf-8")
    }
  })

  test("节流：短时间内的重复落盘被抑制，避免 state 目录变成写盘热点", () => {
    const original = fs.existsSync(ANCHOR_FILE) ? fs.readFileSync(ANCHOR_FILE, "utf-8") : undefined
    try {
      fs.rmSync(ANCHOR_FILE, { force: true })
      const anchor = new Map([["ses_1", { cacheRead: 100, inputTokens: 200 }]])
      persistCacheAnchors(anchor, 10_000_000_000_000)
      expect(JSON.parse(fs.readFileSync(ANCHOR_FILE, "utf-8"))).toEqual({
        ses_1: { cacheRead: 100, inputTokens: 200 },
      })

      // 30s 内的第二次调用被抑制：内容仍是第一次写入的结果
      anchor.set("ses_2", { cacheRead: 1, inputTokens: 2 })
      persistCacheAnchors(anchor, 10_000_000_000_000 + 1_000)
      expect(Object.keys(JSON.parse(fs.readFileSync(ANCHOR_FILE, "utf-8")))).toHaveLength(1)

      // 超过间隔后才更新
      persistCacheAnchors(anchor, 10_000_000_000_000 + 60_000)
      expect(Object.keys(JSON.parse(fs.readFileSync(ANCHOR_FILE, "utf-8")))).toHaveLength(2)
    } finally {
      if (original === undefined) fs.rmSync(ANCHOR_FILE, { force: true })
      else fs.writeFileSync(ANCHOR_FILE, original, "utf-8")
    }
  })
})

describe("漂移判定语义未被改动", () => {
  test("跌幅超阈值才报漂移", () => {
    expect(detectCacheDrift({ prevCacheRead: 10_000, curCacheRead: 1_000, prevInputTokens: 10_000 })).not.toBeNull()
    expect(detectCacheDrift({ prevCacheRead: 10_000, curCacheRead: 9_800, prevInputTokens: 10_000 })).toBeNull()
    expect(detectCacheDrift({ prevCacheRead: 0, curCacheRead: 0 })).toBeNull()
  })

  test("没有上一轮锚点时第一轮不报", () => {
    const anchor = new Map<string, { cacheRead: number; inputTokens: number }>()
    expect(trackCacheDrift(anchor, "ses_new", { cacheRead: 0, inputTokens: 5_000 })).toBeNull()
  })

  test("usage 全缺失时不记锚点，避免下一轮误报 100% 下跌", () => {
    const anchor = new Map<string, { cacheRead: number; inputTokens: number }>()
    trackCacheDrift(anchor, "ses_a", { cacheRead: 8_000, inputTokens: 9_000 })
    expect(trackCacheDrift(anchor, "ses_a", { cacheRead: 0, inputTokens: 0 })).toBeNull()
    expect(anchor.get("ses_a")).toEqual({ cacheRead: 8_000, inputTokens: 9_000 })
  })
})