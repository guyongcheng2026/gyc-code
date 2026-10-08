import { describe, expect, test } from "bun:test"
import { join } from "node:path"

/**
 * P3：createSpinner().start() 没有重入守卫。
 *
 * 二次 start 会覆盖 interval 引用，第一次的定时器再也 clear 不掉 —— spinner 停了
 * 输出还在动。同时 stop 必须把引用置空，否则 stop 之后再 start 会被守卫挡住。
 *
 * 源码断言而非行为测试：renderer.ts 会连带引入 stream-cli、protocol v2、UI、theme
 * 整条 CLI 依赖链，为一个 2 行守卫付这个导入代价不划算。
 */
describe("createSpinner 重入与重启", () => {
  const readSource = () => Bun.file(join(import.meta.dir, "renderer.ts")).text()

  test("start 有重入守卫", async () => {
    const source = await readSource()

    expect(source).toContain("if (interval) return")
  })

  test("stop 置空 interval，保证可重新 start", async () => {
    const source = await readSource()

    expect(source).toContain("interval = undefined")
  })
})
