import { describe, expect, test } from "bun:test"
import { describeToolNameConflict, findToolNameConflicts, withConflictNotice } from "./catalog"

describe("MCP 工具名冲突检测", () => {
  test("不同 server 的同名工具不算冲突（已被 server 前缀区分）", () => {
    const conflicts = findToolNameConflicts([
      { server: "alpha", tools: [{ name: "search" }] },
      { server: "beta", tools: [{ name: "search" }] },
    ])
    expect(conflicts).toEqual([])
  })

  test("sanitize 塌缩导致的跨 server 冲突会被检出", () => {
    const conflicts = findToolNameConflicts([
      { server: "a.b", tools: [{ name: "search" }] },
      { server: "a_b", tools: [{ name: "search" }] },
    ])
    expect(conflicts.length).toBe(1)
    expect(conflicts[0]!.tool).toBe("a_b_search")
    expect(conflicts[0]!.owners).toEqual([
      { server: "a.b", raw: "search" },
      { server: "a_b", raw: "search" },
    ])
  })

  test("连字符不在 sanitize 的替换范围内，因此不算冲突", () => {
    expect(
      findToolNameConflicts([
        { server: "a.b", tools: [{ name: "search" }] },
        { server: "a-b", tools: [{ name: "search" }] },
      ]),
    ).toEqual([])
  })

  test("同一 server 内 sanitize 塌缩也算冲突", () => {
    const conflicts = findToolNameConflicts([
      { server: "alpha", tools: [{ name: "read.file" }, { name: "read_file" }] },
    ])
    expect(conflicts.length).toBe(1)
    expect(conflicts[0]!.tool).toBe("alpha_read_file")
    expect(conflicts[0]!.owners.map((owner) => owner.raw)).toEqual(["read.file", "read_file"])
  })

  test("同一 server 内同名重复工具会被去重，不误报", () => {
    const conflicts = findToolNameConflicts([
      { server: "alpha", tools: [{ name: "read" }, { name: "read" }] },
    ])
    expect(conflicts).toEqual([])
  })

  test("owner 去重后只剩一个就不算冲突", () => {
    const conflicts = findToolNameConflicts([
      { server: "alpha", tools: [{ name: "read" }] },
      { server: "alpha", tools: [{ name: "read" }] },
    ])
    expect(conflicts).toEqual([])
  })

  test("无冲突输入返回空数组", () => {
    expect(findToolNameConflicts([])).toEqual([])
    expect(findToolNameConflicts([{ server: "alpha", tools: [] }])).toEqual([])
  })
})

describe("MCP 工具名冲突文案", () => {
  const conflict = {
    tool: "a_b_search",
    owners: [
      { server: "a.b", raw: "search" },
      { server: "a_b", raw: "search" },
    ],
  }

  test("同时点名抢占了工具名的每个 server", () => {
    const text = describeToolNameConflict(conflict)
    expect(text).toContain("a_b_search")
    expect(text).toContain("a.b")
    expect(text).toContain("a_b")
  })

  test("明确告知模型哪个 server 抢占了工具名", () => {
    const text = describeToolNameConflict(conflict)
    expect(text).toContain("工具名冲突")
    expect(text).toContain("抢占")
    expect(text).toContain("当前生效")
  })

  test("冲突说明挂到 description，不动 name 与 inputSchema", () => {
    const def = { name: "search", description: "原始描述", inputSchema: { type: "object" as const } }
    const annotated = withConflictNotice(def, describeToolNameConflict(conflict))
    expect(annotated.name).toBe("search")
    expect(annotated.inputSchema).toBe(def.inputSchema)
    expect(annotated.description).toContain("原始描述")
    expect(annotated.description).toContain("抢占")
    expect(def.description).toBe("原始描述")
  })

  test("没有原始描述时也能挂上说明", () => {
    const bare: Parameters<typeof withConflictNotice>[0] = {
      name: "search",
      inputSchema: { type: "object" as const },
    }
    const annotated = withConflictNotice(bare, describeToolNameConflict(conflict))
    expect(annotated.description).toContain("抢占")
  })
})
