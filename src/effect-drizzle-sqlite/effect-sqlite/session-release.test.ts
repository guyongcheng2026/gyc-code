import { describe, expect, test } from "bun:test"
import { join } from "node:path"

/**
 * P2-21：嵌套事务（id !== 0）成功路径只跑 release savepoint，而该 release 被
 * `Effect.catch(() => Effect.void)` 吞掉 —— release 失败会留下悬挂 savepoint，
 * 但外层拿到的仍是「成功」。
 *
 * 失败路径与 ensuring 兜底允许吞错：那两条路径已有错误要传播，吞掉 release 的
 * 错误是为了不覆盖原始失败。只有「成功但没真正提交完成」这一条必须向外暴露。
 */
describe("effect-sqlite 嵌套事务 release 不静默", () => {
  test("嵌套成功路径使用不吞错的 release", async () => {
    const source = await Bun.file(join(import.meta.dir, "session.ts")).text()

    // 两条独立的 release：常量那条吞错（仅供 ensuring/回滚兜底），成功分支那条不吞。
    const releases = source.match(/release savepoint effect_sql_\$\{id\}/g) ?? []
    expect(releases.length).toBeGreaterThanOrEqual(2)

    // 成功分支若写成裸 `: releaseSavepoint`，就把吞错那条接进了唯一必须暴露错误的路径。
    expect(source).not.toMatch(/^\s*: releaseSavepoint$/m)
  })

  test("确保/回滚兜底路径仍保留吞错，不覆盖原始失败", async () => {
    const source = await Bun.file(join(import.meta.dir, "session.ts")).text()

    expect(source).toContain(".pipe(Effect.catch(() => Effect.void))")
  })
})
