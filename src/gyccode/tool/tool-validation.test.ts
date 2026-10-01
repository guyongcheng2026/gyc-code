import { describe, expect, test } from "bun:test"
import { Effect, Schema } from "effect"
import { invalidArgumentsDetail, InvalidArgumentsError } from "./tool"
import { errorMessage } from "../../tui/util/error"

const Params = Schema.Struct({
  path: Schema.String,
  limit: Schema.optional(Schema.Number),
})

const toolDef = {
  id: "demo",
  description: "演示工具",
  parameters: Params,
  execute: () => Effect.succeed({ title: "t", metadata: {}, output: "ok" }),
}

describe("S-04 参数校验失败必须回灌 schema", () => {
  test("提示里带上期望的 JSON Schema，让模型知道该怎么改", () => {
    const detail = invalidArgumentsDetail(toolDef, "缺少 path")
    expect(detail).toContain("缺少 path")
    expect(detail).toContain("JSON Schema")
    expect(detail).toContain('"path"')
  })

  test("工具自带的 formatValidationError 优先于默认错误序列化", () => {
    const detail = invalidArgumentsDetail(toolDef, { raw: true }, () => "自定义校验说明")
    expect(detail).toContain("自定义校验说明")
    expect(detail).not.toContain("[object Object]")
  })

  test("参数失败经 orDie/runPromise 后文案仍能回到模型", async () => {
    // 核实结论：wrap 里的 Effect.orDie 不会吞掉文案。runPromise 对 defect 的
    // 拒绝值就是 Error 本身，processor 的 errorMessage 能取回 message，
    // 模型因此能看到 schema 并重试。此测试锁住该语义，防止后续重构改坏。
    const err = new InvalidArgumentsError({ tool: "read", detail: invalidArgumentsDetail(toolDef, "缺少 path") })
    let rejected: unknown
    try {
      await Effect.runPromise(Effect.die(err))
    } catch (e) {
      rejected = e
    }
    const text = errorMessage(rejected)
    expect(text).toContain("read")
    expect(text).toContain("缺少 path")
    expect(text).toContain("JSON Schema")
  })

  test("schema 推导失败时不抛异常，只退回原始校验信息", () => {
    const broken = {
      id: "broken",
      description: "schema 不可用",
      parameters: undefined as unknown as typeof Params,
      execute: toolDef.execute,
    }
    expect(() => invalidArgumentsDetail(broken, "原始错误")).not.toThrow()
    expect(invalidArgumentsDetail(broken, "原始错误")).toContain("原始错误")
  })
})