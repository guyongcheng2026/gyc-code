import { describe, expect, test } from "bun:test"
import { join } from "node:path"

/**
 * P2-22：revert 的 diff 持久化失败此前被 Effect.ignore 完全吞掉。
 *
 * diff 仍会经事件与内存暴露（revert.ts:76-77），所以这里只要求「失败必须可观测」，
 * 不要求改成本失败。持久化失败若静默，事后无法解释「为什么重进会话 diff 没了」。
 */
describe("session.revert diff 持久化失败可观测", () => {
  test("storage.write 失败不再被 Effect.ignore 静默吞掉", async () => {
    const source = await Bun.file(join(import.meta.dir, "revert.ts")).text()

    expect(source).toContain('logError("session.revert.persist-diff"')
    expect(source).toContain('"session.id": input.sessionID')
    expect(source).not.toContain('["session_diff", input.sessionID], diffs).pipe(Effect.ignore)')
  })
})
