import { describe, expect, it } from "bun:test"
import { Effect } from "effect"
import { Truncate } from "./truncate"
import { buildSkeleton, compact, shouldCompact } from "./read-compaction"

/**
 * P1-3（对标指标 6 · 文件操作 · §1.3 缺口「read 无自动 compaction」）：
 * 此前 read 命中字节上限时只丢一句 `Use offset=… to continue.`（read.ts:397-404），
 * 模型必须自己再花一次工具调用翻页。这里锁定「骨架 + 指针」的折叠行为。
 */

/** 生成 n 行内容，其中每隔若干行放一条符号声明，便于断言大纲。 */
const fixture = (n: number) =>
  Array.from({ length: n }, (_, i) => {
    const no = i + 1
    if (no === 1) return `export const TOP = "start"`
    if (no % 50 === 0) return `export function symbol${no}(arg: string) {`
    return `const filler${no} = ${no}`
  })

describe("shouldCompact", () => {
  it("整文件读取被截断时应折叠", () => {
    expect(shouldCompact({ truncated: true })).toBe(true)
  })

  it("未截断时不折叠（内容已经完整，无需再造骨架）", () => {
    expect(shouldCompact({ truncated: false })).toBe(false)
  })

  it("模型显式给了 offset/limit 时尊重其窗口，不折叠", () => {
    expect(shouldCompact({ truncated: true, offset: 100 })).toBe(false)
    expect(shouldCompact({ truncated: true, limit: 50 })).toBe(false)
  })
})

describe("buildSkeleton", () => {
  it("保留 read 既有的 path/type/content 外壳，保证下游解析不变", () => {
    const skeleton = buildSkeleton({ filepath: "C:\\repo\\a.ts", lines: fixture(10), savedPath: "/tmp/tool_1" })
    expect(skeleton.content).toContain("<path>C:\\repo\\a.ts</path>")
    expect(skeleton.content).toContain("<type>file</type>")
    expect(skeleton.content).toContain("<content>")
    expect(skeleton.content).toContain("</content>")
  })

  it("输出体积远小于原文（这是 compaction 的目的）", () => {
    const lines = fixture(4000)
    const full = lines.join("\n")
    const skeleton = buildSkeleton({ filepath: "a.ts", lines, savedPath: "/tmp/tool_1" })
    expect(skeleton.content.length).toBeLessThan(full.length / 10)
  })

  it("给出带行号的符号大纲", () => {
    const skeleton = buildSkeleton({ filepath: "a.ts", lines: fixture(200), savedPath: "/tmp/tool_1" })
    expect(skeleton.content).toContain("50: export function symbol50(arg: string) {")
    // 纯数据绑定（`const TOP = "start"`）不是符号声明，不进大纲
    expect(skeleton.outlineCount).toBe(4)
  })

  it("普通赋值行不进大纲，避免大纲被噪声淹没", () => {
    const skeleton = buildSkeleton({
      filepath: "a.ts",
      lines: ["const filler1 = 1", "  // 注释", "  return value", "}"],
      savedPath: "/tmp/tool_1",
    })
    expect(skeleton.outlineCount).toBe(0)
    expect(skeleton.content).toContain("未发现符号声明")
  })

  // 已知限制：方法简写（`handler() {`）与调用语句无法区分，故不计入大纲（见报告）
  it("函数与绑定形式的声明算符号声明", () => {
    const skeleton = buildSkeleton({
      filepath: "a.ts",
      lines: ["export const run = async (x: number) => x", "const obj = { a: 1 }", "def main():", "  fn helper() {}"],
      savedPath: "/tmp/tool_1",
    })
    expect(skeleton.outlineCount).toBe(3)
  })

  it("保留首尾样本，让模型仍能判断文件形态", () => {
    const skeleton = buildSkeleton({ filepath: "a.ts", lines: fixture(1000), savedPath: "/tmp/tool_1" })
    expect(skeleton.content).toContain("1: export const TOP = \"start\"")
    expect(skeleton.content).toContain("1000: export function symbol1000(arg: string) {")
  })

  it("小文件不重复首尾（总行数不足时只给一份）", () => {
    const lines = fixture(5)
    const skeleton = buildSkeleton({ filepath: "a.ts", lines, savedPath: "/tmp/tool_1" })
    expect(skeleton.content).toContain("const filler5 = 5")
    expect(skeleton.content).not.toContain("<tail")
  })

  it("大纲超上限时截断并显式告知省略了多少条", () => {
    const lines = Array.from({ length: 1200 }, (_, i) => `export function f${i}() {`)
    const skeleton = buildSkeleton({ filepath: "a.ts", lines, savedPath: "/tmp/tool_1" })
    expect(skeleton.outlineCount).toBe(200)
    expect(skeleton.outlineTruncated).toBe(true)
    expect(skeleton.content).toContain("另有 1000 条符号声明未列出")
  })

  it("带落盘指针与定位指令（不必再花一次工具调用翻页）", () => {
    const skeleton = buildSkeleton({ filepath: "a.ts", lines: fixture(4000), savedPath: "/tmp/tool_1" })
    expect(skeleton.content).toContain("/tmp/tool_1")
    expect(skeleton.content).toContain("offset=")
    expect(skeleton.content).toContain("grep")
  })
})

describe("compact", () => {
  it("完整内容经 Truncate.write 落盘并返回骨架", async () => {
    const written: string[] = []
    const stub = {
      write: (text: string) =>
        Effect.sync(() => {
          written.push(text)
          return "/tmp/trunc/tool_abc"
        }),
    } as unknown as Truncate.Interface

    const text = fixture(3000).join("\n")
    const skeleton = await Effect.runPromise(
      compact(stub, { filepath: "a.ts", text }),
    )

    expect(written).toHaveLength(1)
    expect(written[0]).toBe(text)
    expect(skeleton.content).toContain("/tmp/trunc/tool_abc")
    expect(skeleton.content).toContain("</content>")
  })
})