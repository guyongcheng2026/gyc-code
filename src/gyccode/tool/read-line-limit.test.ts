import { describe, expect, test } from "bun:test"
import { readFileSync } from "node:fs"
import path from "node:path"

/**
 * P1-4：read 的行数上限命中后不终止上游流。
 *
 * 此前 `ReadTool.lines` 的行数上限分支只置 `flags.more = true` 就 return，
 * 不抛 ReadStop → 上游 `fs.stream` 把整个文件读完，且因已提前 return，
 * 字节上限分支永远到不了。`read(file, limit=1)` 一个 5GB 日志 = 全量 I/O。
 *
 * 字节上限分支（`flags.cut`）一直是正确的（会 `yield* new ReadStop()`），
 * 这里锁住行数上限分支与它对齐。
 *
 * 同时锁定「提前终止后 count 不再是总行数」这一副作用的两个消费点：
 * `:575` 的 `of ${count}` 展示、`:590` 的 displayEnd —— 提前终止时
 * `count` 是「扫描到的位置」而非文件总行数，照原样展示会给出错误总数。
 */

const source = () => readFileSync(path.join(import.meta.dir, "read.ts"), "utf8")

/** 切出行数上限分支（`raw.length >= opts.limit`）的函数体，避免被字节上限分支命中干扰。 */
const lineLimitBranch = () => {
  const text = source()
  const idx = text.indexOf("if (raw.length >= opts.limit)")
  expect(idx).toBeGreaterThan(-1)
  return text.slice(idx, idx + 220)
}

describe("read 行数上限必须终止上游流", () => {
  test("行数上限分支抛 ReadStop（与字节上限分支一致）", () => {
    const branch = lineLimitBranch()
    expect(branch).toContain("yield* new ReadStop()")
  })

  test("字节上限分支同样终止流（防止被改动退化）", () => {
    const text = source()
    const idx = text.indexOf("flags.cut = true")
    expect(idx).toBeGreaterThan(-1)
    expect(text.slice(idx, idx + 200)).toContain("yield* new ReadStop()")
  })

  test("行数上限命中仍标记 more，调用方靠它提示还有更多行", () => {
    expect(lineLimitBranch()).toContain("flags.more = true")
  })
})

describe("提前终止后 count 的语义必须显式区分", () => {
  test("lines 返回 countExact 标志", () => {
    expect(source()).toContain("countExact: flags.countExact")
  })

  test("行数上限提前终止时把 countExact 置 false", () => {
    expect(lineLimitBranch()).toContain("countExact = false")
  })

  test("展示 total 行数时先检查 countExact，避免给出错误总数", () => {
    const text = source()
    // 定位 `} else if (file.more) {` 分支（不能用 indexOf 找 "Use offset="，
    // 那会命中更前面的 file.cut 分支）
    const idx = text.indexOf("} else if (file.more) {")
    expect(idx).toBeGreaterThan(-1)
    const branch = text.slice(idx, idx + 500)
    // countExact 为真才允许打印 `of ${file.count}`
    expect(branch).toContain("file.countExact")
    expect(branch).toContain("of ${file.count}")
    // count 不精确时的降级文案：不再给出总数，只给续读指引
    expect(branch).toContain(`Use offset=${"${next}"} to continue.`)
    expect(branch).toContain(`${"${file.offset}"}-${"${last}"}. Use offset`)
  })

  test("折叠展示的 displayEnd 在 count 不精确时改由全文行数给出", () => {
    expect(source()).toContain("compactionTotal")
  })
})
