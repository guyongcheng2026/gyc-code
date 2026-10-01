import { describe, expect, test } from "bun:test"
import { Effect, Schema } from "effect"
import { invalidArgumentsDetail } from "./tool"

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