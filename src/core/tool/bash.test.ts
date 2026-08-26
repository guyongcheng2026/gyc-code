import { describe, expect, test } from "bun:test"
import path from "path"
import { BashTool } from "./bash"

describe("BashTool.blockedExternalPaths", () => {
  const cwd = path.resolve("C:/work/project")
  const inside = path.resolve("C:/work/project/sub")
  const outside = path.resolve("C:/Windows/System32")
  const allowed = path.resolve("C:/work/allowed")

  test("无外部目录时返回空", () => {
    expect(BashTool.blockedExternalPaths([], [])).toEqual([])
  })

  test("未配置白名单时全部拦截", () => {
    expect(BashTool.blockedExternalPaths([outside], [])).toEqual([outside])
  })

  test("位于允许根内的目录放行", () => {
    expect(BashTool.blockedExternalPaths([inside, outside], [cwd])).toEqual([outside])
  })

  test("命中 allow_paths 的目录放行", () => {
    expect(BashTool.blockedExternalPaths([allowed], [cwd, allowed])).toEqual([])
  })

  test("允许根的父目录不覆盖子目录之外路径", () => {
    const sibling = path.resolve("C:/work/allowed-sibling")
    expect(BashTool.blockedExternalPaths([sibling], [allowed])).toEqual([sibling])
  })
})
