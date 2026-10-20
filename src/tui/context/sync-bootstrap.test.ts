import { describe, expect, it } from "bun:test"
import { safeQuery } from "./sync"

// bootstrap 非阻塞阶段的查询隔离。
//
// 背景：非阻塞阶段原本用 `void Promise.all([...])` 收尾，各查询都没有 catch。
// 任一失败 → Promise.all reject → rejection 无 handler → unhandledRejection
// → crash-classify 判为不可恢复 → degrade(reason, 1) → 进安全模式并
// process.exit(1)。表现为「长会话里偶发退回 fallback 甚至重启」，与渲染/类型
// 错误都无关，极难归因。

describe("safeQuery", () => {
  it("查询失败时返回 undefined，不让 rejection 冒泡", async () => {
    const errors: Array<[string, unknown]> = []
    const result = await safeQuery(
      "command.list",
      Promise.reject(new Error("boom")),
      (name, error) => errors.push([name, error]),
    )
    expect(result).toBeUndefined()
    expect(errors.length).toBe(1)
    expect(errors[0]![0]).toBe("command.list")
  })

  it("查询成功时原样返回值，不触发错误回调", async () => {
    let called = false
    const result = await safeQuery("lsp.status", Promise.resolve(["ok"]), () => {
      called = true
    })
    expect(result).toEqual(["ok"])
    expect(called).toBe(false)
  })

  it("非 Error 的拒绝值也能安全处理", async () => {
    const errors: Array<[string, unknown]> = []
    const result = await safeQuery("vcs.get", Promise.reject("plain string"), (name, error) =>
      errors.push([name, error]),
    )
    expect(result).toBeUndefined()
    expect(errors[0]![1]).toBe("plain string")
  })

  it("多个查询中单个失败不影响其余查询（Promise.all 不会因此 reject）", async () => {
    const results = await Promise.all([
      safeQuery("a", Promise.reject(new Error("x"))),
      safeQuery("b", Promise.resolve(2)),
      safeQuery("c", Promise.reject(new Error("y"))),
      safeQuery("d", Promise.resolve(4)),
    ])
    expect(results).toEqual([undefined, 2, undefined, 4])
  })

  it("返回的 promise 一定 resolve，绝不 reject", async () => {
    const p = safeQuery("x", Promise.reject(new Error("boom")))
    const outcome = await p.then(
      () => "resolved",
      () => "rejected",
    )
    expect(outcome).toBe("resolved")
  })
})
