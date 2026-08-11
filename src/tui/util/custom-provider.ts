const OPENAI_COMPATIBLE = "@ai-sdk/openai-compatible"
const PROVIDER_ID_RE = /^[a-z0-9][a-z0-9-_]*$/

export type CustomProviderModelRow = { id: string; name: string }
export type CustomProviderHeaderRow = { key: string; value: string }

export type CustomProviderFormInput = {
  providerID: string
  name: string
  baseURL: string
  key?: string
  modelRows: CustomProviderModelRow[]
  headerRows?: CustomProviderHeaderRow[]
}

export type CustomProviderFormErrors = {
  providerID?: string
  name?: string
  baseURL?: string
  models?: Record<number, { id?: string; name?: string }>
  headers?: Record<number, { key?: string; value?: string }>
}

export function hasFormErrors(errors: CustomProviderFormErrors): boolean {
  return Boolean(errors.providerID || errors.name || errors.baseURL || errors.models || errors.headers)
}

export function validateCustomProviderForm(input: {
  providerID: string
  name: string
  baseURL: string
  modelRows: CustomProviderModelRow[]
  headerRows?: CustomProviderHeaderRow[]
  existingProviderIDs: Set<string>
}): CustomProviderFormErrors {
  const errors: CustomProviderFormErrors = {}
  const providerID = input.providerID.trim()
  if (!providerID) errors.providerID = "提供商 ID 不能为空"
  else if (!PROVIDER_ID_RE.test(providerID)) errors.providerID = "以小写字母或数字开头，仅可含小写字母、数字、连字符、下划线"
  else if (input.existingProviderIDs.has(providerID)) errors.providerID = "该提供商 ID 已存在"

  if (!input.name.trim()) errors.name = "提供商名称不能为空"
  if (!/^https?:\/\//.test(input.baseURL.trim())) errors.baseURL = "API 地址必须以 http:// 或 https:// 开头"

  const seenModels = new Set<string>()
  const modelErrors: Record<number, { id?: string; name?: string }> = {}
  input.modelRows.forEach((row, index) => {
    const id = row.id.trim()
    if (!id) modelErrors[index] = { id: "模型 ID 不能为空", ...modelErrors[index] }
    else if (seenModels.has(id)) modelErrors[index] = { id: "模型 ID 重复", ...modelErrors[index] }
    else seenModels.add(id)
  })
  if (Object.keys(modelErrors).length > 0) errors.models = modelErrors

  const seenHeaders = new Set<string>()
  const headerErrors: Record<number, { key?: string; value?: string }> = {}
  input.headerRows?.forEach((row, index) => {
    const key = row.key.trim()
    const value = row.value.trim()
    if (!key && !value) return
    if (!key) headerErrors[index] = { key: "请求头名称不能为空", ...headerErrors[index] }
    else if (seenHeaders.has(key.toLowerCase())) headerErrors[index] = { key: "请求头重复", ...headerErrors[index] }
    else seenHeaders.add(key.toLowerCase())
    if (!value) headerErrors[index] = { value: "请求头值不能为空", ...headerErrors[index] }
  })
  if (Object.keys(headerErrors).length > 0) errors.headers = headerErrors

  return errors
}

export type CustomProviderConfig = {
  name: string
  npm: string
  api: string
  options?: { headers: Record<string, string> }
  models: Record<string, { name: string; tool_call: boolean }>
}

export function buildCustomProviderConfig(input: CustomProviderFormInput): CustomProviderConfig {
  const models: CustomProviderConfig["models"] = {}
  for (const row of input.modelRows) {
    const id = row.id.trim()
    if (!id) continue
    models[id] = { name: row.name.trim() || id, tool_call: true }
  }
  const headers: Record<string, string> = {}
  for (const row of input.headerRows ?? []) {
    const key = row.key.trim()
    const value = row.value.trim()
    if (key && value) headers[key] = value
  }
  return {
    name: input.name.trim(),
    npm: OPENAI_COMPATIBLE,
    api: input.baseURL.trim(),
    ...(Object.keys(headers).length > 0 ? { options: { headers } } : {}),
    models,
  }
}
