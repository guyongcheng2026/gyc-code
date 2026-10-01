import { describe, expect, it } from "bun:test"
import { mapApiModel, mergeApiModels, parseApiModels } from "./api-models"
import type { Model } from "./provider"

const target = {
  providerID: "openRouter",
  npm: "@openrouter/ai-sdk-provider",
  baseURL: "https://openrouter.ai/api/v1",
  url: "https://openrouter.ai/api/v1",
}

describe("parseApiModels", () => {
  it("parses OpenAI-compatible { data: [...] } payloads", () => {
    const models = parseApiModels({ data: [{ id: "a/b", context_length: 1000 }] })
    expect(models).toEqual([{ id: "a/b", context_length: 1000 }])
  })

  it("parses bare array payloads", () => {
    expect(parseApiModels([{ id: "x" }])).toEqual([{ id: "x" }])
  })

  it("drops entries without a usable id", () => {
    expect(parseApiModels({ data: [{ id: "" }, { id: 3 }, {}, { id: "ok" }] })).toEqual([{ id: "ok" }])
  })

  it("returns an empty list for non-object payloads", () => {
    expect(parseApiModels(undefined)).toEqual([])
    expect(parseApiModels("nope")).toEqual([])
    expect(parseApiModels({ data: {} })).toEqual([])
  })

  it("keeps unknown fields but normalises the recognised ones", () => {
    const [model] = parseApiModels({
      data: [
        {
          id: "vendor/model",
          name: "Vendor Model",
          context_length: 200000,
          pricing: { prompt: 0.000001, completion: 0.000002 },
          architecture: { input_modalities: ["text", "image"], output_modalities: ["text"] },
          supported_parameters: ["tools", "tool_choice"],
          top_provider: { context_length: 128000, max_completion_tokens: 4096 },
          future_field: 1,
        },
      ],
    })
    expect(model?.context_length).toBe(200000)
    expect(model?.pricing).toEqual({ prompt: 0.000001, completion: 0.000002 })
    expect(model?.top_provider?.max_completion_tokens).toBe(4096)
  })
})

describe("mapApiModel", () => {
  it("converts per-token pricing into per-million cost", () => {
    const model = mapApiModel(
      {
        id: "vendor/model",
        pricing: { prompt: 0.00000125, completion: 0.00001 },
      },
      target,
    )
    expect(model.cost.input).toBe(1.25)
    expect(model.cost.output).toBe(10)
    expect(model.priced).toBe(true)
  })

  it("prefers top_provider context over context_length and flags it as unknown pricing", () => {
    const model = mapApiModel(
      { id: "vendor/model", context_length: 200000, top_provider: { context_length: 128000 } },
      target,
    )
    expect(model.limit.context).toBe(128000)
    expect(model.priced).toBe(false)
    expect(model.status).toBe("active")
  })

  it("maps modalities and tool support from supported_parameters", () => {
    const model = mapApiModel(
      {
        id: "vendor/model",
        architecture: { input_modalities: ["text", "image", "audio"], output_modalities: ["text"] },
        supported_parameters: ["tools", "tool_choice"],
      },
      target,
    )
    expect(model.capabilities.input).toEqual({ text: true, audio: true, image: true, video: false, pdf: false })
    expect(model.capabilities.output.text).toBe(true)
    expect(model.capabilities.toolcall).toBe(true)
    expect(model.capabilities.reasoning).toBe(false)
  })

  it("keeps tools and text on for sparse listings that omit supported_parameters", () => {
    // opencode zen answers with nothing but {id, object, created, owned_by};
    // reading that as "no tool support" would make every zen model unusable.
    const model = mapApiModel({ id: "vendor/model" }, target)
    expect(model.capabilities.toolcall).toBe(true)
    expect(model.capabilities.temperature).toBe(true)
    expect(model.capabilities.input.text).toBe(true)
    expect(model.capabilities.output.text).toBe(true)
  })

  it("honours an explicit supported_parameters that excludes tools", () => {
    const model = mapApiModel({ id: "vendor/model", supported_parameters: ["temperature"] }, target)
    expect(model.capabilities.toolcall).toBe(false)
    expect(model.capabilities.temperature).toBe(true)
  })

  it("falls back to the model id for the display name", () => {
    expect(mapApiModel({ id: "vendor/model" }, target).name).toBe("vendor/model")
    expect(mapApiModel({ id: "vendor/model", name: "Pretty" }, target).name).toBe("Pretty")
  })

  it("keeps the api id verbatim", () => {
    const model = mapApiModel({ id: "vendor/model-1m" }, target)
    expect(String(model.id)).toBe("vendor/model-1m")
  })
})

describe("mergeApiModels", () => {
  const existing = { id: "a/b", providerID: "openRouter", name: "Catalog" } as unknown as Model

  it("adds api models that the catalog does not know yet", () => {
    const merged = mergeApiModels({}, [{ id: "a/b" }], target)
    expect(Object.keys(merged)).toEqual(["a/b"])
  })

  it("never overwrites catalog metadata for a model that already exists", () => {
    const merged = mergeApiModels(
      { "a/b": { ...existing, name: "Catalog Name", limit: { context: 111, output: 0 } } },
      [{ id: "a/b", name: "API Name" }],
      target,
    )
    expect(merged["a/b"]?.name).toBe("Catalog Name")
    expect(merged["a/b"]?.limit.context).toBe(111)
  })

  it("keeps configured models that the api no longer lists", () => {
    const merged = mergeApiModels(
      { "a/b": { ...existing, name: "Configured" } },
      [{ id: "c/d" }],
      target,
    )
    expect(Object.keys(merged).sort()).toEqual(["a/b", "c/d"])
  })
})
