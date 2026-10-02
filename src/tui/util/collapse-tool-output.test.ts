import { describe, expect, test } from "bun:test"
import { collapseToolOutput } from "./collapse-tool-output"

describe("collapseToolOutput", () => {
  test("未超限：原样返回且 overflow 为 false", () => {
    const r = collapseToolOutput("hello\nworld", 10, 100)
    expect(r.output).toBe("hello\nworld")
    expect(r.overflow).toBe(false)
  })

  test("超行数：保留前 maxLines 行并追加省略标记", () => {
    const out = Array.from({ length: 50 }, (_, i) => `l${i}`).join("\n")
    const r = collapseToolOutput(out, 5, 100_000)
    expect(r.overflow).toBe(true)
    expect(r.output.split("\n")).toHaveLength(6)
    expect(r.output.endsWith("…")).toBe(true)
  })

  test("超字符数：在行数范围内按码点截断", () => {
    const r = collapseToolOutput("中文中文中文中文", 10, 4)
    expect(r.overflow).toBe(true)
    expect(Array.from(r.output.replace("…", "")).length).toBeLessThanOrEqual(4)
  })

  test("中文字符按码点而非字节计（行为与既有语义一致）", () => {
    // 4 个中文字 = 4 码点，未超 4 的预算
    expect(collapseToolOutput("中文中文", 10, 4).overflow).toBe(false)
    expect(collapseToolOutput("中文中文中", 10, 4).overflow).toBe(true)
  })

  test("空串不溢出", () => {
    const r = collapseToolOutput("", 10, 10)
    expect(r.overflow).toBe(false)
    expect(r.output).toBe("")
  })

  test("大输入的堆增量受限：不对全文做 Array.from 物化（内存回归）", () => {
    // 旧实现对完整 output 执行 Array.from(output).length：32MB ASCII 输入实测
    // 产生约 38MB 堆增量（约 3,400 万个数组槽位）；且该函数被包在 createMemo
    // 中，流式期间对同一 output 反复触发，是长会话内存虚高的直接来源。
    // 新实现只对已切片的前缀计长，堆增量应接近 0。
    const huge = "x".repeat(32 * 1024 * 1024)
    globalThis.gc?.()
    const before = process.memoryUsage().heapUsed
    const r = collapseToolOutput(huge, 20, 200)
    globalThis.gc?.()
    const deltaMB = (process.memoryUsage().heapUsed - before) / 1024 / 1024
    expect(r.overflow).toBe(true)
    expect(deltaMB).toBeLessThan(8)
  })

  test("单行超长（无换行）也能按预算截断", () => {
    const r = collapseToolOutput("y".repeat(10_000), 5, 50)
    expect(r.overflow).toBe(true)
    expect(Array.from(r.output.replace("…", "")).length).toBeLessThanOrEqual(50)
  })

  test("恰好等于预算：不溢出", () => {
    expect(collapseToolOutput("abcd", 10, 4).overflow).toBe(false)
  })
})
