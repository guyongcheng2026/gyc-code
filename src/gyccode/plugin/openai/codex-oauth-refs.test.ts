import { describe, expect, test } from "bun:test"
import { join } from "node:path"

/**
 * P2-2：codex 的 OAuth 回调引用泄漏。
 *
 * `stopOAuthServer()` 原写在 `const tokens = await callbackPromise` 之后，而
 * `callback` 是急切调用的（`provider/auth.ts:202` 非 code 方法直接 `match.callback()`）：
 * 回调一旦超时、被 /cancel 取消，或供应商回传 error 参数，`await` 直接抛出，
 * `stopOAuthServer()` 永不执行 → `startOAuthServer()` 取的引用永不归还 →
 * `oauthServerRefs` 长期 > 0 → 回调端口上的 HTTP 监听器再也不会关闭。
 *
 * 同仓 `digitalocean.ts:308-310`、`snowflake-cortex.ts:488-490` 都已是
 * try/finally 形态，codex.ts 是唯一的例外。
 */
describe("codex OAuth 回调引用必须无条件归还", () => {
  test("stopOAuthServer() 位于 finally 中", async () => {
    const source = await Bun.file(join(import.meta.dir, "codex.ts")).text()

    expect(source).toMatch(/finally \{\s*\n\s*stopOAuthServer\(\)/)
    // 反例：成功路径上的顺序调用 —— 失败路径不会执行，正是本缺陷的形态。
    expect(source).not.toMatch(/await callbackPromise\n\s*stopOAuthServer\(\)/)
  })
})
