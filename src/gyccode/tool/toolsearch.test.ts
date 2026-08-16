import { describe, expect, test } from "bun:test"
import { searchTools, type SearchToolSource } from "./toolsearch"

const TOOLS: SearchToolSource[] = [
  { id: "read", description: "Read files from the filesystem" },
  { id: "glob", description: "Find files by glob pattern" },
  { id: "grep", description: "Search file contents with regex" },
  { id: "todo", description: "Manage the todo list" },
  { id: "skill", description: "Load a specialized skill" },
  { id: "sleep", description: "Wait for a specified duration" },
  { id: "config", description: "Read or modify gyc configuration" },
]

describe("tool_search 搜索", () => {
  test("select: 直接选择多个工具", () => {
    const got = searchTools("select:read,glob", TOOLS, 5)
    expect(got).toEqual(["read", "glob"])
  })

  test("select: 部分不存在的名称返回已存在的", () => {
    const got = searchTools("select:read,nope", TOOLS, 5)
    expect(got).toEqual(["read"])
  })

  test("关键字命中工具名", () => {
    expect(searchTools("todo", TOOLS, 5)).toContain("todo")
    expect(searchTools("sleep", TOOLS, 5)).toContain("sleep")
  })

  test("关键字命中描述", () => {
    expect(searchTools("wait", TOOLS, 5)).toContain("sleep")
    expect(searchTools("filesystem", TOOLS, 5)).toContain("read")
  })

  test("无匹配返回空数组", () => {
    expect(searchTools("zzzz-not-exist", TOOLS, 5)).toEqual([])
  })

  test("max_results 限制结果数量", () => {
    const got = searchTools("file", TOOLS, 2)
    expect(got.length).toBeLessThanOrEqual(2)
  })

  test("空查询返回空数组", () => {
    expect(searchTools("", TOOLS, 5)).toEqual([])
    expect(searchTools("  ", TOOLS, 5)).toEqual([])
  })
})
