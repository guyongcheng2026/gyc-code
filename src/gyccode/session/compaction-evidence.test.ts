import { describe, expect, test } from "bun:test"
import {
  ALWAYS_PROTECTED_TOOLS,
  EVIDENCE_KEEP_CHARS,
  EVIDENCE_TOOLS,
  isProtectedToolOutput,
  keepsTailOnTruncate,
  outputLengthOf,
  REPRODUCIBLE_EVIDENCE_TOOLS,
} from "./compaction-evidence"
import { extract } from "./instruction"
import type { SessionV1 } from "@gyccode/core/v1/session"

describe("证据密度保护清单（H-05）", () => {
  test("skill 无条件保护，与输出长度无关", () => {
    expect(isProtectedToolOutput("skill", 0)).toBe(true)
    expect(isProtectedToolOutput("skill", EVIDENCE_KEEP_CHARS * 10)).toBe(true)
  })

  test("read/grep/glob 的事实证据不再被清掉", () => {
    for (const tool of EVIDENCE_TOOLS) {
      expect(isProtectedToolOutput(tool, 120)).toBe(true)
      expect(isProtectedToolOutput(tool, EVIDENCE_KEEP_CHARS)).toBe(true)
    }
  })

  test("超长证据输出超出闸门后不再整份保护，否则压缩会彻底失效", () => {
    expect(isProtectedToolOutput("read", EVIDENCE_KEEP_CHARS + 1)).toBe(false)
  })

  test("bash 属可重建证据：短输出（结论/报错）保护，长输出可回收", () => {
    for (const tool of REPRODUCIBLE_EVIDENCE_TOOLS) {
      expect(isProtectedToolOutput(tool, 80)).toBe(true)
      expect(isProtectedToolOutput(tool, EVIDENCE_KEEP_CHARS + 1)).toBe(false)
    }
  })

  test("写类工具输出只是变更回执，git 可恢复，不保护", () => {
    for (const tool of ["edit", "write", "patch", "multiedit"]) {
      expect(isProtectedToolOutput(tool, 10)).toBe(false)
    }
  })

  test("未知工具按不可保护处理", () => {
    expect(isProtectedToolOutput("mystery-tool", 10)).toBe(false)
  })

  test("无输出的 part 视为空输出", () => {
    expect(outputLengthOf(undefined)).toBe(0)
    expect(outputLengthOf(123)).toBe(0)
    expect(outputLengthOf("abcd")).toBe(4)
  })

  test("只有证据类工具在截断时额外保尾部", () => {
    expect(keepsTailOnTruncate("read")).toBe(true)
    expect(keepsTailOnTruncate("bash")).toBe(true)
    expect(keepsTailOnTruncate("edit")).toBe(false)
    expect(keepsTailOnTruncate(undefined)).toBe(false)
  })

  test("保护集合互不重叠，避免同一工具被两套规则重复判定", () => {
    for (const tool of ALWAYS_PROTECTED_TOOLS) {
      expect(EVIDENCE_TOOLS.has(tool)).toBe(false)
      expect(REPRODUCIBLE_EVIDENCE_TOOLS.has(tool)).toBe(false)
    }
  })
})

describe("压缩后已读集合不清零（S-07）", () => {
  const readPart = (files: string[], compacted: boolean) =>
    ({
      type: "tool",
      tool: "read",
      state: {
        status: "completed",
        metadata: { loaded: files },
        time: { start: 0, end: 1, compacted },
      },
    }) as unknown as SessionV1.Part

  const message = (parts: SessionV1.Part[]) =>
    ({ info: { role: "assistant", id: "m1" }, parts }) as unknown as SessionV1.WithParts

  test("压缩后的 read part 仍计入已读集合", () => {
    const msgs = [message([readPart(["/a/b.ts"], true)])]
    expect(Array.from(extract(msgs))).toEqual(["/a/b.ts"])
  })

  test("未压缩的 read part 行为不变", () => {
    const msgs = [message([readPart(["/a/b.ts"], false)])]
    expect(Array.from(extract(msgs))).toEqual(["/a/b.ts"])
  })

  test("压缩与未压缩的 read part 合并去重", () => {
    const msgs = [message([readPart(["/a/b.ts", "/c.ts"], true), readPart(["/a/b.ts"], false)])]
    expect(Array.from(extract(msgs)).sort()).toEqual(["/a/b.ts", "/c.ts"])
  })

  test("非 read 工具与未完成状态不计入", () => {
    const other = { type: "tool", tool: "grep", state: { status: "completed", metadata: { loaded: ["/x"] } } }
    const running = { type: "tool", tool: "read", state: { status: "running", metadata: { loaded: ["/y"] } } }
    const msgs = [message([other as unknown as SessionV1.Part, running as unknown as SessionV1.Part])]
    expect(Array.from(extract(msgs))).toEqual([])
  })

  test("metadata.loaded 缺失或非数组时安全跳过", () => {
    const msgs = [
      message([
        { type: "tool", tool: "read", state: { status: "completed", metadata: {} } } as unknown as SessionV1.Part,
        { type: "tool", tool: "read", state: { status: "completed", metadata: { loaded: "oops" } } } as unknown as SessionV1.Part,
      ]),
    ]
    expect(Array.from(extract(msgs))).toEqual([])
  })
})