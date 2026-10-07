import { describe, expect, test } from "bun:test"
import { join } from "node:path"

/**
 * P2-15：微信网关的游标与上下文令牌写盘失败此前用 .catch(() => undefined) 完全静默。
 *
 * sync-buf 游标写失败 → 下次重启从旧游标起拉，可能出现消息重复/漏拉且无任何痕迹；
 * context token 存失败 → 上下文关联丢失。两者都必须留下可检索的错误记录。
 */
describe("gateway.weixin 游标与上下文令牌写盘可观测", () => {
  const readSource = () => Bun.file(join(import.meta.dir, "weixin.ts")).text()

  test("sync-buf 游标写失败落到 logError 并带 accountId", async () => {
    const source = await readSource()

    expect(source).toContain('logError("gateway.weixin.persist-sync-buf"')
    expect(source).toContain("accountId: this.config!.accountId")
    expect(source).not.toContain(
      'await writeJson("sync-buf.json", { accountId: this.config!.accountId, buf: syncBuf }).catch(() => undefined)',
    )
  })

  test("context token 存失败落到 logError", async () => {
    const source = await readSource()

    expect(source).toContain('logError("gateway.weixin.save-context-token"')
    expect(source).not.toContain("await this.saveContextToken(senderId, ctxToken).catch(() => undefined)")
  })
})
