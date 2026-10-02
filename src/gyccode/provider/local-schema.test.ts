import { describe, expect, test } from "bun:test"
import { Effect, Schema } from "effect"
import { Model } from "./provider"
import { parseOllamaTags } from "./local"

describe("本机模型符合 Provider.Model schema", () => {
  test("parseOllamaTags 的产物能通过 Model 校验", async () => {
    const parsed = parseOllamaTags({ models: [{ name: "qwen3:8b" }, { name: "llama3:1b" }] })
    expect(Object.keys(parsed)).toHaveLength(2)

    // 若字段与 schema 不符，这里会失败而不是在 provider 加载时才炸
    const decoded = await Effect.runPromise(
      Effect.all(Object.values(parsed).map((m) => Schema.decodeUnknownEffect(Model)(m))),
    )
    expect(decoded).toHaveLength(2)
    expect(String(decoded[0]!.providerID)).toBe("ollama")
  })

  test("api 字段指向 OpenAI 兼容端点", () => {
    const models = parseOllamaTags({ models: [{ name: "x:1b" }] })
    const api = models["x:1b"]!.api
    expect(api.npm).toBe("@ai-sdk/openai-compatible")
    expect(api.url).toContain("localhost")
  })
})