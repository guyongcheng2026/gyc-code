import { describe, expect, test } from "bun:test"
import { readFileSync } from "node:fs"
import path from "node:path"
import { GrepTool } from "./grep"

/** `src/gyccode/tool/grep.ts` 的 `emptyMatchNotice` 基准文案，用于断言逐字一致。 */
const baseline = (pattern: string, dir?: string): string =>
  `No matches found for pattern /${pattern}/${dir ? ` in ${dir}` : ""}. The pattern does not occur in any searched file's contents. If you expected a match: widen the pattern, pass \`include\`, or point \`path\` at a different directory. Do not conclude the symbol or file does not exist from this result alone.`

describe("core grep 空结果文案（H-04）", () => {
  test("与 src/gyccode/tool/grep.ts 的 emptyMatchNotice 逐字一致", () => {
    expect(GrepTool.toModelOutput([], "FooBar")).toBe(baseline("FooBar"))
    expect(GrepTool.toModelOutput([], "FooBar", "src/core")).toBe(baseline("FooBar", "src/core"))
  })

  test("不再输出误导性的 No files found", () => {
    expect(GrepTool.toModelOutput([], "FooBar")).not.toContain("No files found")
  })

  test("文案带上 pattern 与 path，让模型知道搜的是什么、在哪搜的、没搜到", () => {
    const text = GrepTool.toModelOutput([], "FooBar", "src/core")
    expect(text).toContain("/FooBar/")
    expect(text).toContain("in src/core")
    expect(text).toContain("No matches found")
  })

  test("源码接线把 pattern/path 传进文案，且旧占位文案未被摘掉", () => {
    const source = readFileSync(path.join(import.meta.dir, "grep.ts"), "utf8")
    expect(source).toMatch(/input\.pattern,\s*\r?\n\s*input\.path/)
    expect(source).not.toContain("No files found")
  })
})