import { describe, expect, test } from "bun:test"
import { DEFAULT_BASE_URL, parseOllamaTags } from "./local"

describe("本机推理模型探测", () => {
  test("默认指向 Ollama 本机端口", () => {
    expect(DEFAULT_BASE_URL).toBe("http://localhost:11434/v1")
  })

  test("解析 /api/tags 响应为模型表", () => {
    const models = parseOllamaTags({
      models: [
        { name: "qwen3:8b", size: 5000000000, digest: "abc" },
        { name: "llama3.2:latest", size: 2000000000, digest: "def" },
      ],
    })
    expect(Object.keys(models).sort()).toEqual(["llama3.2:latest", "qwen3:8b"])
    expect(models["qwen3:8b"]?.name).toBe("qwen3:8b")
  })

  test("本机模型成本恒为 0 且 priced=false", () => {
    const models = parseOllamaTags({ models: [{ name: "local:1b", size: 1, digest: "x" }] })
    const model = models["local:1b"]!
    expect(model.cost.input).toBe(0)
    expect(model.cost.output).toBe(0)
    // priced=false 表示「本机推理不计费」，与「价格未知」语义不同
    expect(model.priced).toBe(false)
    // 不得声称是云端免费模型
    expect(String(model.providerID)).toBe("ollama")
  })

  test("空列表返回空表", () => {
    expect(parseOllamaTags({ models: [] })).toEqual({})
  })

  test("响应畸形时不抛异常", () => {
    expect(parseOllamaTags({})).toEqual({})
    expect(parseOllamaTags({ models: "not-an-array" })).toEqual({})
    expect(parseOllamaTags(null)).toEqual({})
  })

  test("缺少 name 的条目被跳过而非产生空键", () => {
    const models = parseOllamaTags({ models: [{ size: 1 }, { name: "ok:1b" }] } as never)
    expect(Object.keys(models)).toEqual(["ok:1b"])
  })
})