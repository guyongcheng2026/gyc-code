import { describe, expect, test } from "bun:test"
import { readFileSync } from "node:fs"
import path from "node:path"
import { emptyMatchNotice } from "./grep"

describe("gyccode glob 空结果文案（H-04）", () => {
  test("glob 复用 grep 的 emptyMatchNotice，措辞与基准完全一致", () => {
    expect(emptyMatchNotice("*.ts")).toContain("No matches found for pattern /*.ts/")
    expect(emptyMatchNotice("*.ts", "src")).toContain("in src")
    expect(emptyMatchNotice("*.ts")).not.toContain("No files found")
  })

  test("源码接线仍使用 emptyMatchNotice，占位文案未被摘掉", () => {
    const source = readFileSync(path.join(import.meta.dir, "glob.ts"), "utf8")
    expect(source).toContain('import { emptyMatchNotice } from "./grep"')
    expect(source).toContain("output.push(emptyMatchNotice(params.pattern, params.path))")
    expect(source).not.toContain("No files found")
  })
})