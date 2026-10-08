import { describe, expect, test } from "bun:test"
import { join } from "node:path"

/**
 * P3：glob 的截断误报。
 *
 * 原先 `truncated = files.length === limit`：恰好 100 个匹配时会报「已截断」，
 * 把模型引向无意义地收窄 pattern。修法是向 ripgrep 多要 1 条用于判断「是否还有
 * 更多」，代价仍是 O(limit)，没有变成 O(全部)。
 *
 * 这里用源码断言：glob 工具的执行体依赖 InstanceState/FSUtil/Ripgrep 三个 Effect
 * 服务，搭行为级夹具的成本高于这条回归护栏能挡住的收益。
 */
describe("glob 截断判定", () => {
  const readSource = () => Bun.file(join(import.meta.dir, "glob.ts")).text()

  test("多取 1 条判断是否还有更多，而非按 length === limit 判等", async () => {
    const source = await readSource()

    expect(source).toContain("limit: limit + 1")
    expect(source).toContain("const truncated = files.length > limit")
    expect(source).not.toContain("const truncated = files.length === limit")
  })

  test("输出与 metadata 使用截断后的列表", async () => {
    const source = await readSource()

    expect(source).toContain("const shown = truncated ? files.slice(0, limit) : files")
    expect(source).toContain("count: shown.length")
  })
})
