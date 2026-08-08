import { describe, expect, test } from "bun:test"
import { logo } from "./logo"

// GYC CODE 字标不变量：纯块字符、无阴影标记、三排字形严格等宽，
// 保证主界面字标整体水平居中、无模糊阴影（尤其 Y 字清晰）。
const LEGAL = new Set(["\u2588", "\u2580", "\u2584", " "])
const SHADOW_MARKS = ["_", "^", "~", ","]

describe("GYCCODE logo 字标", () => {
  test("left/right 均为 4 行（顶部留白 + 三排字形）", () => {
    expect(logo.left).toHaveLength(4)
    expect(logo.right).toHaveLength(4)
  })

  test("left 三排字形与顶部留白严格等宽（17）", () => {
    const widths = logo.left.map((line) => line.length)
    expect(new Set(widths)).toEqual(new Set([17]))
  })

  test("right 三排字形与顶部留白严格等宽（23）", () => {
    const widths = logo.right.map((line) => line.length)
    expect(new Set(widths)).toEqual(new Set([23]))
  })

  test("三排字形 + 顶部留白 每行总宽一致（left + gap + right = 41）", () => {
    const totals = logo.left.map((line, i) => line.length + 1 + (logo.right[i]?.length ?? 0))
    expect(new Set(totals)).toEqual(new Set([41]))
  })

  test("字形只含纯块字符与空格，无阴影标记（避免模糊）", () => {
    for (const line of [...logo.left, ...logo.right]) {
      for (const char of line) {
        expect(LEGAL.has(char), `\u975e\u6cd5\u5b57\u7b26 ${JSON.stringify(char)}`).toBe(true)
      }
      for (const mark of SHADOW_MARKS) {
        expect(line.includes(mark), `\u542b\u9634\u5f71\u6807\u8bb0 ${mark}`).toBe(false)
      }
    }
  })

  test("Y 字轮廓清晰：顶部两腿 + 交叉横条 + 底部柱", () => {
    const top = logo.left[1]
    const mid = logo.left[2]
    const bot = logo.left[3]
    expect(top.slice(6, 11)).toBe("\u2588   \u2588")
    expect(mid.slice(6, 11)).toBe("\u2580\u2580\u2588\u2580\u2580")
    expect(bot.slice(6, 11)).toBe("  \u2588  ")
  })
})