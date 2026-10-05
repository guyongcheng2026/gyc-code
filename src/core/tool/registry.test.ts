import type { ToolDefinition } from "@gyccode/llm"
import { describe, expect, test } from "bun:test"
import {
  DEFAULT_DESCRIPTION_TRIM_THRESHOLD,
  DEFAULT_FREQUENT_TOOLS,
  trimDefinitions,
  type TrimOptions,
} from "./registry"

/**
 * G-27-1：工具定义全量物化挤占上下文。
 *
 * 这些用例锁定三条语义：
 * 1. 工具数不超过阈值时完全不裁剪（既有行为零回归）
 * 2. 超过阈值时对次要工具裁描述，高频工具保留完整描述
 * 3. 结果确定：同样输入两次调用得到相同顺序与相同内容
 */

const makeDefinition = (name: string, description: string) =>
  ({ name, description, inputSchema: {}, outputSchema: {} }) as unknown as ToolDefinition

const many = (count: number) =>
  Array.from({ length: count }, (_, index) => makeDefinition(`tool_${String(index).padStart(2, "0")}`, "第一行说明\n第二行细节\n第三行补充"))

describe("trimDefinitions（工具定义按需裁剪）", () => {
  test("不超过阈值时完全不裁剪，描述逐字保留", () => {
    const input = many(3)
    const result = trimDefinitions(input, { threshold: 10 })
    expect(result.map((item) => item.description)).toEqual(input.map((item) => item.description))
  })

  test("阈值缺省时使用内置保守默认值，且默认不触发裁剪", () => {
    const input = many(3)
    const result = trimDefinitions(input, {})
    expect(result).toHaveLength(3)
    expect(result[0]!.description).toBe(input[0]!.description)
    expect(DEFAULT_DESCRIPTION_TRIM_THRESHOLD).toBeGreaterThanOrEqual(3)
  })

  test("超过阈值时裁剪次要工具描述，但保留工具名与能力要点", () => {
    const input = many(12)
    const result = trimDefinitions(input, { threshold: 5 })
    const trimmed = result.find((item) => item.description !== input[result.indexOf(item)]!.description)
    expect(trimmed).toBeDefined()
    // 裁剪后仍须保留工具名，且描述非空
    for (const item of result) {
      expect(item.name).toBeTruthy()
      expect(item.description.length).toBeGreaterThan(0)
    }
    // 被裁剪的那条必须比原文短
    const index = result.findIndex((item) => item.name === trimmed!.name)
    expect(result[index]!.description.length).toBeLessThan(input[index]!.description.length)
  })

  test("高频工具即使超过阈值也保留完整描述", () => {
    const frequent = DEFAULT_FREQUENT_TOOLS[0]!
    const input = [...many(12), makeDefinition(frequent, "高频工具的完整描述不应被裁剪")]
    const result = trimDefinitions(input, { threshold: 5 })
    const kept = result.find((item) => item.name === frequent)
    expect(kept!.description).toBe("高频工具的完整描述不应被裁剪")
  })

  test("只裁剪到第一行，保留能力要点不误导模型", () => {
    const input = many(12)
    const result = trimDefinitions(input, { threshold: 5 })
    for (const item of result) {
      expect(item.description.split("\n")).toHaveLength(1)
    }
  })

  test("确定性：同样输入两次调用得到相同顺序与相同内容", () => {
    const input = many(20)
    const options: TrimOptions = { threshold: 5 }
    const first = trimDefinitions(input, options)
    const second = trimDefinitions(input, options)
    expect(second.map((item) => item.name)).toEqual(first.map((item) => item.name))
    expect(second.map((item) => item.description)).toEqual(first.map((item) => item.description))
  })

  test("排序不依赖 Map 迭代顺序：按工具名字典序产出", () => {
    const input = [makeDefinition("zeta", "z"), makeDefinition("alpha", "a"), makeDefinition("mid", "m")]
    const result = trimDefinitions(input, { threshold: 100 })
    expect(result.map((item) => item.name)).toEqual(["alpha", "mid", "zeta"])
  })

  test("非法阈值（0 / 负数 / NaN）夹到保守值，等同于不裁剪", () => {
    const input = many(3)
    for (const threshold of [0, -1, Number.NaN]) {
      const result = trimDefinitions(input, { threshold })
      expect(result.map((item) => item.description)).toEqual(input.map((item) => item.description))
    }
  })

  test("全部为高频工具时不裁剪任何一条", () => {
    const input = DEFAULT_FREQUENT_TOOLS.slice(0, 6).map((name) => makeDefinition(name, "高频描述"))
    const result = trimDefinitions(input, { threshold: 1 })
    expect(result.map((item) => item.description)).toEqual(["高频描述", "高频描述", "高频描述", "高频描述", "高频描述", "高频描述"])
  })
})