import { describe, expect, test } from "bun:test"
import { handleBudgetPressure } from "./handle-pressure"

describe("handleBudgetPressure", () => {
  test("占用为 0：无压力", () => {
    expect(handleBudgetPressure(0, 100)).toBe("none")
  })

  test("占用 < 60%：无压力", () => {
    expect(handleBudgetPressure(59, 100)).toBe("none")
  })

  test("占用 60%~79%：warn（提示可能已开始折叠）", () => {
    expect(handleBudgetPressure(60, 100)).toBe("warn")
    expect(handleBudgetPressure(79, 100)).toBe("warn")
  })

  test("占用 ≥ 80%：critical（应主动收窗而非等 freemem 下降）", () => {
    expect(handleBudgetPressure(80, 100)).toBe("critical")
    expect(handleBudgetPressure(100, 100)).toBe("critical")
  })

  test("limit ≤ 0 时视为无压力（预算未启用）", () => {
    expect(handleBudgetPressure(999, 0)).toBe("none")
  })

  test("limit ≤ 0 且 used 为 0：无压力", () => {
    expect(handleBudgetPressure(0, 0)).toBe("none")
  })
})
