import { describe, expect, test } from "bun:test"
import {
  DEFAULT_MAX_CONTENT_BYTES,
  DEFAULT_MAX_CONTENT_LINES,
  limitContent,
  limitContentLines,
} from "./limit-content"

describe("limitContentLines", () => {
  test("未超行数上限：原样返回", () => {
    expect(limitContentLines("a\nb\nc", 10)).toBe("a\nb\nc")
  })

  test("恰好等于上限：不折叠", () => {
    const text = Array.from({ length: 10 }, (_, i) => `l${i}`).join("\n")
    expect(limitContentLines(text, 10)).toBe(text)
  })

  test("超出行数上限：折叠并追加省略标记", () => {
    const text = Array.from({ length: 50 }, (_, i) => `l${i}`).join("\n")
    const out = limitContentLines(text, 10)
    expect(out.split("\n")).toHaveLength(11)
    expect(out.endsWith("…")).toBe(true)
    expect(out.startsWith("l0\nl1\n")).toBe(true)
  })

  test("行数上限 ≤ 0 时不做行折叠（防御非法配置）", () => {
    expect(limitContentLines("a\nb\nc\nd", 0)).toBe("a\nb\nc\nd")
  })
})

describe("limitContent 字节预算", () => {
  test("小内容：truncated 为 false，原样返回", () => {
    const r = limitContent("hello", { maxBytes: 1024, maxLines: 100 })
    expect(r.truncated).toBe(false)
    expect(r.text).toBe("hello")
    expect(r.hiddenLines).toBe(0)
  })

  test("超字节预算：按码点截断且不切碎代理对", () => {
    // 每字符 3 字节（中文），10 个中文字符 = 30 字节 > 预算 12
    const r = limitContent("中文中文中文中文中文", { maxBytes: 12, maxLines: 100 })
    expect(r.truncated).toBe(true)
    expect(Buffer.byteLength(r.text, "utf8")).toBeLessThanOrEqual(12)
  })

  test("超行数预算：hiddenLines 记录被折叠行数", () => {
    const text = Array.from({ length: 100 }, (_, i) => `line ${i}`).join("\n")
    const r = limitContent(text, { maxBytes: 1024 * 1024, maxLines: 10 })
    expect(r.truncated).toBe(true)
    expect(r.hiddenLines).toBeGreaterThan(0)
  })

  test("行数与字节双超：两种原因都生效，hiddenLines 仍大于 0", () => {
    const text = Array.from({ length: 200 }, (_, i) => "中".repeat(100) + i).join("\n")
    const r = limitContent(text, { maxBytes: 2048, maxLines: 20 })
    expect(r.truncated).toBe(true)
    expect(Buffer.byteLength(r.text, "utf8")).toBeLessThanOrEqual(2048)
    expect(r.text.split("\n").length).toBeLessThanOrEqual(21)
  })

  test("折叠标记自身计入字节预算（不得超限）", () => {
    const text = "中".repeat(10_000)
    const r = limitContent(text, { maxBytes: 100, maxLines: 100 })
    expect(Buffer.byteLength(r.text, "utf8")).toBeLessThanOrEqual(100)
  })

  test("空内容：truncated 为 false", () => {
    const r = limitContent("", { maxBytes: 100, maxLines: 10 })
    expect(r.truncated).toBe(false)
    expect(r.text).toBe("")
  })

  test("emoji 不被切碎（代理对完整）", () => {
    const r = limitContent("😀".repeat(50), { maxBytes: 20, maxLines: 100 })
    expect(r.text).not.toContain("�")
    // 按码元扫描：高位代理后必须紧跟低位代理，否则即为孤立代理项
    for (let i = 0; i < r.text.length; i++) {
      const unit = r.text.charCodeAt(i)
      if (unit >= 0xd800 && unit <= 0xdbff) {
        const next = r.text.charCodeAt(i + 1)
        expect(next >= 0xdc00 && next <= 0xdfff).toBe(true)
        i += 1
      } else {
        expect(unit >= 0xdc00 && unit <= 0xdfff).toBe(false)
      }
    }
  })

  test("使用默认上限时大内容也会被截断", () => {
    const text = Array.from({ length: DEFAULT_MAX_CONTENT_LINES + 500 }, (_, i) => `l${i}`).join("\n")
    const r = limitContent(text)
    expect(r.truncated).toBe(true)
  })

  test("默认字节上限为 512KB 量级（跨 5 万行工具输出的兜底）", () => {
    expect(DEFAULT_MAX_CONTENT_BYTES).toBeGreaterThanOrEqual(256 * 1024)
    const huge = "x".repeat(DEFAULT_MAX_CONTENT_BYTES + 1)
    expect(limitContent(huge).truncated).toBe(true)
  })
})
