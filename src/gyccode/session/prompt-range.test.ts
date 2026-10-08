import { describe, expect, test } from "bun:test"
import { join } from "node:path"

/**
 * P3 三项（同在 prompt.ts）：
 *
 * 1. URL 的 start/end 走 `parseInt` 无 radix、也不校验 NaN —— NaN 会一路流进
 *    read 工具的 offset（它不会报错，只会读到错误位置）。
 * 2. LSP 的 `r.start.line` 是 0 基，而 URL 里的 start 是 read 工具的 1 基行号。
 *    原实现直接比较、又把 0 基值写回 start，于是「跳到符号」永远差一行。
 * 3. `Today's date` 用 `toISOString()`（UTC）：东八区用户在本地 08:00 之前会被
 *    告知「今天是昨天」，与本地日历不一致 —— quota-alert.ts 已因同一理由改用本地时区。
 *
 * 源码断言：这条链路要跑通需装配完整 session 依赖，成本远高于收益。
 */
describe("prompt 的 range 解析与日期注入", () => {
  const readSource = () => Bun.file(join(import.meta.dir, "prompt.ts")).text()

  test("range 按十进制解析且 NaN 不进 offset", async () => {
    const source = await readSource()

    expect(source).toContain("Number.parseInt(range.start, 10)")
    expect(source).not.toContain("let start = parseInt(range.start)")
  })

  test("LSP 0 基行号与 1 基 start 之间做换算", async () => {
    const source = await readSource()

    expect(source).toContain("r.start.line === start - 1")
    expect(source).toContain("start = r.start.line + 1")
  })

  test("Today's date 使用本地时区", async () => {
    const source = await readSource()

    expect(source).not.toContain("new Date().toISOString().slice(0, 10)")
    expect(source).toContain("today.getFullYear()")
  })
})
