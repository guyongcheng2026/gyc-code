import { describe, expect, test } from "bun:test"
import { readFileSync } from "node:fs"
import path from "node:path"

/**
 * P1-3：健康检查端点恒真。
 *
 * 原实现只 `Effect.succeed({ healthy: true })`，不探活 DB、不探子进程、不探磁盘 ——
 * 对外永远返回绿灯，作为探针是误导性的。
 *
 * 修法：真实探活数据库（与同层 fence.ts / session.ts 同一 db 形状），失败时返回
 * 503 `HttpApiError.ServiceUnavailable` 而非改 success schema —— 这样 **200 恒等于
 * 「真的健康」**，且不需要改 `Schema.Literal(true)`、也就不会让
 * `src/protocol/v2/gen/types.gen.ts`（产物，禁手改）过期。
 *
 * 探活本身不引入新的挂起源：探针走同步 SQLite 查询，不 fork、不等网络。
 */

const repo = (...parts: string[]) => readFileSync(path.join(import.meta.dir, "..", "..", "..", ...parts), "utf8")

describe("健康检查必须真实探活", () => {
  test("shared/handlers/health.ts 依赖 Database.Service 而不是恒真", () => {
    const text = repo("server", "shared", "handlers", "health.ts")
    expect(text).toContain("Database.Service")
    // 只看代码，不看注释（注释里会引用被替换掉的旧写法做说明）
    const code = text
      .split("\n")
      .filter((line) => !line.trim().startsWith("//"))
      .join("\n")
    expect(code).not.toMatch(/Effect\.succeed\(\{\s*healthy/)
    expect(code).toContain("Effect.map")
  })

  test("探活失败返回 ServiceUnavailable，不吞错误", () => {
    const text = repo("server", "shared", "handlers", "health.ts")
    expect(text).toContain("ServiceUnavailable")
    expect(text).toContain("Effect.fail")
  })

  test("httpapi 的 global health handler 同样探活", () => {
    const text = repo("server", "routes", "instance", "httpapi", "handlers", "global.ts")
    expect(text).toContain("Database.Service")
    expect(text).toContain("ServiceUnavailable")
  })
})

describe("200 的语义必须保持为「真的健康」", () => {
  test("v2 /api/health 的 success schema 不放宽（仍为字面量 true）", () => {
    const text = readFileSync(
      path.join(import.meta.dir, "..", "..", "..", "..", "protocol", "groups", "health.ts"),
      "utf8",
    )
    expect(text).toContain("Schema.Literal(true)")
    // 探活失败走声明过的 503 错误通道
    expect(text).toContain("HttpApiError.ServiceUnavailable")
  })

  test("global /global/health 的 success schema 不放宽", () => {
    const text = repo("server", "routes", "instance", "httpapi", "groups", "global.ts")
    expect(text).toContain("healthy: Schema.Literal(true)")
    expect(text).toContain("HttpApiError.ServiceUnavailable")
  })
})
