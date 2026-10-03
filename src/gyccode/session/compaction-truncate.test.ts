import { describe, expect, test } from "bun:test"
import { readFileSync } from "node:fs"
import path from "node:path"
import { TOOL_OUTPUT_MAX_CHARS, summarizeToolOutput } from "./compaction"

/**
 * H-02（幻觉率）：工具输出被截断时，模型必须同时拿到三样东西——
 * 省略了多少字、完整原文在哪个文件、怎么回查。否则模型会把头部片段当成全文，
 * 进而断言「文件里没有 X」这种从未验证过的结论。
 */

const FULL_PATH = "C:/tmp/gyccode/tool-output/abc123.txt"

describe("summarizeToolOutput · 截断信息完整性", () => {
  test("未超限时原样返回，不加任何截断说明", () => {
    const text = "短文本"
    expect(summarizeToolOutput(text, FULL_PATH)).toBe(text)
  })

  test("恰好等于上限时也不截断", () => {
    const text = "x".repeat(TOOL_OUTPUT_MAX_CHARS)
    expect(summarizeToolOutput(text, FULL_PATH)).toBe(text)
  })

  test("超限时给出省略字数、原文路径与回查指引", () => {
    const text = "x".repeat(TOOL_OUTPUT_MAX_CHARS + 1_000)
    const notice = summarizeToolOutput(text, FULL_PATH)

    expect(notice).toContain("此处省略了 1000 个字符")
    expect(notice).toContain(FULL_PATH)
    expect(notice).toContain("Read")
    expect(notice).toContain("Grep")
    // 明确的反幻觉提示：不得仅凭片段断言全文
    expect(notice).toContain("不要仅凭以上片段断言整个文件的内容")
  })

  test("read 这类证据类工具额外保留尾部（完整性标记常在末尾）", () => {
    const head = "H".repeat(TOOL_OUTPUT_MAX_CHARS)
    const text = head + "MIDDLE".repeat(100) + "Showing lines 10-20 of 200"
    const notice = summarizeToolOutput(text, FULL_PATH, "read")

    expect(notice).toContain("Showing lines 10-20 of 200")
    expect(notice).toContain("（中间内容已省略）")
    expect(notice).toContain(FULL_PATH)
  })

  test("非证据类工具不追加尾部，仍保留路径与省略字数", () => {
    const text = "x".repeat(TOOL_OUTPUT_MAX_CHARS + 800)
    const notice = summarizeToolOutput(text, FULL_PATH, "unknown_tool")

    expect(notice).toContain(FULL_PATH)
    expect(notice).toContain("此处省略了")
    expect(notice).not.toContain("（中间内容已省略）")
  })

  test("省略字数与头部+尾部长度自洽（不会算错账）", () => {
    const text = "x".repeat(TOOL_OUTPUT_MAX_CHARS + 5_000)
    const notice = summarizeToolOutput(text, FULL_PATH, "read")
    const omitted = Number((/此处省略了 ([\d,]+) 个字符/.exec(notice)?.[1] ?? "-1").replaceAll(",", ""))

    expect(omitted).toBeGreaterThan(0)
    expect(omitted).toBe(text.length - TOOL_OUTPUT_MAX_CHARS - 500)
  })

  test("接线未被摘掉：compaction 落盘后再截断（先落盘，避免原文丢失）", () => {
    const source = readFileSync(path.join(import.meta.dir, "compaction.ts"), "utf8")
    const spillAt = source.indexOf("truncate")
    const summarizeAt = source.lastIndexOf("summarizeToolOutput(full, saved, part.tool)")
    expect(spillAt).toBeGreaterThan(-1)
    expect(summarizeAt).toBeGreaterThan(-1)
    expect(spillAt).toBeLessThan(summarizeAt)
  })
})
