import { expect, test } from "bun:test"
import { buildCustomProviderConfig, hasFormErrors, validateCustomProviderForm } from "./custom-provider"

const base = {
  providerID: "my-gateway",
  name: "我的网关",
  baseURL: "https://api.example.com/v1",
  modelRows: [{ id: "model-a", name: "Model A" }],
  existingProviderIDs: new Set<string>(),
}

test("validateCustomProviderForm 通过合法输入", () => {
  expect(hasFormErrors(validateCustomProviderForm(base))).toBe(false)
})

test("validateCustomProviderForm 校验 ID/名称/URL", () => {
  const e1 = validateCustomProviderForm({ ...base, providerID: "" })
  expect(e1.providerID).toBe("提供商 ID 不能为空")
  const e2 = validateCustomProviderForm({ ...base, providerID: "Bad ID" })
  expect(e2.providerID).toContain("小写字母")
  const e3 = validateCustomProviderForm({ ...base, name: "" })
  expect(e3.name).toBe("提供商名称不能为空")
  const e4 = validateCustomProviderForm({ ...base, baseURL: "ftp://x" })
  expect(e4.baseURL).toContain("http")
})

test("validateCustomProviderForm 拒绝已存在 ID、空/重复模型、空请求头", () => {
  const e1 = validateCustomProviderForm({ ...base, existingProviderIDs: new Set(["my-gateway"]) })
  expect(e1.providerID).toBe("该提供商 ID 已存在")
  const e2 = validateCustomProviderForm({ ...base, modelRows: [{ id: "", name: "" }] })
  expect(e2.models?.[0]?.id).toBe("模型 ID 不能为空")
  const e3 = validateCustomProviderForm({ ...base, modelRows: [{ id: "a", name: "" }, { id: "a", name: "" }] })
  expect(e3.models?.[1]?.id).toBe("模型 ID 重复")
  const e4 = validateCustomProviderForm({ ...base, headerRows: [{ key: "", value: "v" }] })
  expect(e4.headers?.[0]?.key).toBe("请求头名称不能为空")
  const e5 = validateCustomProviderForm({ ...base, headerRows: [{ key: "k", value: "" }] })
  expect(e5.headers?.[0]?.value).toBe("请求头值不能为空")
})

test("validateCustomProviderForm 忽略空请求头行", () => {
  expect(hasFormErrors(validateCustomProviderForm({ ...base, headerRows: [{ key: "", value: "" }] }))).toBe(false)
})

test("buildCustomProviderConfig 生成 openai-compatible 配置（模型独立名称/请求头）", () => {
  const config = buildCustomProviderConfig({
    providerID: "my-gateway",
    name: "我的网关",
    baseURL: "https://api.example.com/v1",
    modelRows: [{ id: "model-a", name: "Model A" }, { id: "model-b", name: "" }],
    headerRows: [{ key: "X-Custom", value: "1" }, { key: "", value: "" }],
  })
  expect(config.npm).toBe("@ai-sdk/openai-compatible")
  expect(config.api).toBe("https://api.example.com/v1")
  expect(config.models["model-a"]).toEqual({ name: "Model A", tool_call: true })
  expect(config.models["model-b"]).toEqual({ name: "model-b", tool_call: true })
  expect(config.options?.headers).toEqual({ "X-Custom": "1" })
})
