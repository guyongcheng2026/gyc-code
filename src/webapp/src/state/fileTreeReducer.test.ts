import { describe, expect, it } from "vitest"
import { fileTreeReducer, initialFileTreeState, sortTree, type TreeNode } from "./fileTreeReducer"

const dir: TreeNode = { path: "src", name: "src", type: "directory" }
const file: TreeNode = { path: "src/a.ts", name: "a.ts", type: "file" }

describe("fileTreeReducer", () => {
  it("sets root nodes", () => {
    const s = fileTreeReducer(initialFileTreeState(), { type: "setRoot", nodes: [dir, file] })
    expect(s.root).toHaveLength(2)
  })

  it("toggles expansion", () => {
    let s = initialFileTreeState()
    s = fileTreeReducer(s, { type: "toggle", path: "src" })
    expect(s.expanded["src"]).toBe(true)
    s = fileTreeReducer(s, { type: "toggle", path: "src" })
    expect(s.expanded["src"]).toBe(false)
  })

  it("stores children per directory", () => {
    const s = fileTreeReducer(initialFileTreeState(), { type: "setChildren", path: "src", nodes: [file] })
    expect(s.children["src"]).toHaveLength(1)
  })
})

describe("sortTree", () => {
  it("puts directories first, then files alphabetically", () => {
    const nodes: TreeNode[] = [
      { path: "z.ts", name: "z.ts", type: "file" },
      { path: "b", name: "b", type: "directory" },
      { path: "a.ts", name: "a.ts", type: "file" },
    ]
    expect(sortTree(nodes).map((n) => n.name)).toEqual(["b", "a.ts", "z.ts"])
  })
})
