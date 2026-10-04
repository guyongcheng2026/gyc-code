import { describe, expect, test } from "bun:test"
import { readFileSync } from "node:fs"
import path from "node:path"

/**
 * builtin 一致性（P0/P1-4 回归）。
 *
 * registry.ts 里工具分两步：先在 `Effect.all({...})` 里逐个 `Tool.init`，
 * 再在 `builtin` 数组里挑选暴露给模型的子集。两步靠人肉对齐，漏一个就是
 * 「搜得到、调不了」——工具在 help/检索里出现，模型调用却报未知工具。
 * find_references 与 file_rollback 正是这样漏掉的，且没有任何测试会发现。
 *
 * 这里锁住不变式：凡是 Tool.init 过的工具，都必须出现在 builtin 数组里。
 */

const REGISTRY = path.join(import.meta.dir, "registry.ts")
const source = readFileSync(REGISTRY, "utf8")

/** `name: Tool.init(x)` 的名字集合（初始化块）。 */
function initialised(): Set<string> {
  const block = source.match(/const tool = yield\* Effect\.all\(\{([\s\S]*?)\n\s*\}\)/)
  if (!block?.[1]) throw new Error("未能定位 Tool.init 初始化块")
  const out = new Set<string>()
  for (const line of block[1].split("\n")) {
    const m = line.match(/^\s*([A-Za-z_$][\w$]*)\s*:\s*Tool\.init\(/)
    if (m?.[1]) out.add(m[1])
  }
  // 条件项也走 Tool.init，形态是 `...(cond ? { name: Tool.init(x) } : {})`
  for (const m of source.matchAll(/\{\s*([A-Za-z_$][\w$]*)\s*:\s*Tool\.init\(/g)) {
    if (m[1]) out.add(m[1])
  }
  return out
}

/** `tool.name` 出现在 builtin 数组里的名字集合。 */
function exposed(): Set<string> {
  const block = source.match(/builtin:\s*\[([\s\S]*?)\n\s*\],/)
  if (!block?.[1]) throw new Error("未能定位 builtin 数组")
  const out = new Set<string>()
  for (const m of block[1].matchAll(/tool\.([A-Za-z_$][\w$]*)/g)) {
    if (m[1]) out.add(m[1])
  }
  return out
}

describe("registry：Tool.init 与 builtin 保持一致", () => {
  test("Tool.init 过的工具全部出现在 builtin 数组中", () => {
    const init = initialised()
    const exposedNames = exposed()
    // 空集合说明解析失配，会让断言变成假绿，必须硬失败
    expect(init.size).toBeGreaterThan(20)
    const missing = [...init].filter((name) => !exposedNames.has(name)).sort()
    expect(missing).toEqual([])
  })

  test("builtin 里不含未初始化的工具（拼写漂移会在这里暴露）", () => {
    const init = initialised()
    const unknown = [...exposed()].filter((name) => !init.has(name)).sort()
    expect(unknown).toEqual([])
  })

  test("本次回归的两个工具确实已进 builtin", () => {
    const exposedNames = exposed()
    expect(exposedNames.has("findReferences")).toBe(true)
    expect(exposedNames.has("fileRollback")).toBe(true)
  })
})