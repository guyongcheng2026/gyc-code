import { describe, expect, test } from "bun:test"
import {
  CONTENT_HANDLE_BUDGET,
  HandleBudget,
  HANDLES_PER_BLOCK,
  HANDLES_PER_TEXT_ROW,
  NATIVE_HANDLE_LIMIT,
  estimateContentHandles,
  visualRows,
} from "./handle-budget"

describe("常量", () => {
  test("原生句柄表上限为 opentui 0.5.6 实测值 65,535", () => {
    expect(NATIVE_HANDLE_LIMIT).toBe(65_535)
  })

  test("常驻 renderable（prompt/sidebar/浮层）预留额度后仍有可用预算", () => {
    expect(CONTENT_HANDLE_BUDGET).toBeGreaterThan(0)
    expect(CONTENT_HANDLE_BUDGET).toBeLessThan(NATIVE_HANDLE_LIMIT)
  })

  test("单个 <text> 行按 3 个句柄计（text_buffer + view + native_renderable）", () => {
    expect(HANDLES_PER_TEXT_ROW).toBe(3)
  })
})

describe("visualRows", () => {
  test("单行短文本占 1 行", () => {
    expect(visualRows("hello", 80)).toBe(1)
  })

  test("短行按换行计数", () => {
    expect(visualRows("a\nb\nc", 80)).toBe(3)
  })

  test("长行按 cols 折行估算", () => {
    // 200 字符 / 每行 80 列 → 3 行
    expect(visualRows("x".repeat(200), 80)).toBe(3)
  })

  test("空串占 1 行（空 <text> 也占句柄）", () => {
    expect(visualRows("", 80)).toBe(1)
  })

  test("cols ≤ 1 视为 1 列，避免除零/死循环", () => {
    expect(visualRows("abc", 0)).toBe(3)
    expect(visualRows("abc", -5)).toBe(3)
  })
})

describe("estimateContentHandles", () => {
  test("空内容仍占 1 行句柄", () => {
    expect(estimateContentHandles("", 80)).toBe(HANDLES_PER_TEXT_ROW)
  })

  test("多行内容按行数累计", () => {
    // 3 行 → 3 行 × 3 句柄
    expect(estimateContentHandles("a\nb\nc", 80)).toBe(3 * HANDLES_PER_TEXT_ROW)
  })

  test("块级内容额外按块计句柄（markdown 块渲染）", () => {
    const blocks = "a\n\nb\n\nc"
    expect(estimateContentHandles(blocks, 80)).toBeGreaterThan(
      estimateContentHandles("a\nb\nc", 80) + HANDLES_PER_BLOCK,
    )
  })

  test("5 万行内容估算远超预算（能识别出会撑爆句柄表的输入）", () => {
    const huge = Array.from({ length: 50_000 }, () => "line").join("\n")
    expect(estimateContentHandles(huge, 80)).toBeGreaterThan(CONTENT_HANDLE_BUDGET)
  })
})

describe("HandleBudget", () => {
  test("reserve 成功返回 true 并累加 used", () => {
    const b = new HandleBudget(100)
    expect(b.reserve(40)).toBe(true)
    expect(b.used()).toBe(40)
    expect(b.reserve(60)).toBe(true)
    expect(b.used()).toBe(100)
  })

  test("超出 limit 时拒绝且不累加", () => {
    const b = new HandleBudget(100)
    expect(b.reserve(80)).toBe(true)
    expect(b.reserve(30)).toBe(false)
    expect(b.used()).toBe(80)
  })

  test("release 归还额度且不会降到负数", () => {
    const b = new HandleBudget(100)
    b.reserve(90)
    b.release(40)
    expect(b.used()).toBe(50)
    b.release(999)
    expect(b.used()).toBe(0)
  })

  test("exhausted 仅在 used 达到 limit 时为 true", () => {
    const b = new HandleBudget(100)
    expect(b.exhausted()).toBe(false)
    b.reserve(100)
    expect(b.exhausted()).toBe(true)
  })

  test("available 返回剩余额度", () => {
    const b = new HandleBudget(100)
    b.reserve(70)
    expect(b.available()).toBe(30)
  })

  // reserve 自 LimitedContent 真正挂上富渲染后才第一次进入生产路径。
  // 若放行 NaN，`#used + NaN > limit` 恒为 false → NaN 被累加进 #used，
  // 此后所有比较都失效，撞上限崩溃的闸门被永久焊死且不报错。
  test("非有限入参被拒绝，不会把 used 污染成 NaN", () => {
    const b = new HandleBudget(100)
    expect(b.reserve(NaN)).toBe(false)
    expect(b.used()).toBe(0)
    expect(Number.isNaN(b.used())).toBe(false)
    expect(b.available()).toBe(100)
    // 污染之后闸门会彻底失效：正常的 10 反而也占了 100
    expect(b.reserve(10)).toBe(true)
    expect(b.used()).toBe(10)
    expect(b.fits(NaN)).toBe(false)
    b.release(NaN)
    expect(b.used()).toBe(10)
    expect(b.available()).toBe(90)
  })

  test("tryReserve：额度不足时返回 false 且不占用", () => {
    const b = new HandleBudget(100)
    expect(b.tryReserve(1000)).toBe(false)
    expect(b.used()).toBe(0)
  })

  test("fits：仅查询，不改变占用", () => {
    const b = new HandleBudget(100)
    expect(b.fits(100)).toBe(true)
    expect(b.fits(101)).toBe(false)
    expect(b.used()).toBe(0)
  })

  test("reset 清零占用", () => {
    const b = new HandleBudget(100)
    b.reserve(90)
    b.reset()
    expect(b.used()).toBe(0)
  })
})
