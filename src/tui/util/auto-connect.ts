export type AutoConnectCandidate = {
  readonly id: string
  readonly name: string
  readonly url: string
  readonly npm?: string
}

export type AutoConnectResult = {
  readonly providerID: string
  readonly name: string
  readonly modelCount: number
}

/**
 * 密钥形态特征短路：命中前缀时只验证对应提供商，避免把密钥发给无关厂商。
 * 无特征的 sk- 类密钥（deepseek/siliconflow/sensenova 等同前缀）只能按候选顺序试探。
 */
const PREFIX_RULES: ReadonlyArray<{ readonly pattern: RegExp; readonly providerID: string }> = [
  { pattern: /^sk-or-/, providerID: "openrouter" },
  { pattern: /^nvapi-/, providerID: "nvidia" },
  { pattern: /^sk-ant-/, providerID: "anthropic" },
  { pattern: /^[0-9a-f]{32}\.[A-Za-z0-9]/, providerID: "zhipuai" },
]

const authHeaders = (npm: string | undefined, key: string): Record<string, string> => {
  if (npm?.includes("@ai-sdk/anthropic")) return { "x-api-key": key }
  if (npm?.includes("@ai-sdk/google")) return { "x-goog-api-key": key }
  return { Authorization: `Bearer ${key}` }
}

/**
 * 用 GET {base}/models 探测密钥是否被该提供商接受。
 * 返回模型数（0 表示端点可用但未给出模型清单）；null 表示不匹配。
 * 单家超时/网络失败按候选排除处理（探测控制流，非错误信号），
 * 完整失败面由调用方统一提示，不逐家上报。
 */
const tryCandidate = async (candidate: AutoConnectCandidate, key: string): Promise<number | null> => {
  const base = candidate.url.replace(/\/+$/, "")
  try {
    const response = await fetch(`${base}/models`, {
      headers: authHeaders(candidate.npm, key),
      signal: AbortSignal.timeout(8_000),
    })
    if (!response.ok) return null
    const body = (await response.json()) as { data?: unknown; models?: unknown }
    const list = Array.isArray(body.data) ? body.data : Array.isArray(body.models) ? body.models : []
    return list.length
  } catch {
    return null
  }
}

/** 逐个候选探测密钥，返回第一个接受它的提供商及可用模型数。 */
export async function detectProvider(
  key: string,
  candidates: ReadonlyArray<AutoConnectCandidate>,
): Promise<AutoConnectResult | null> {
  const trimmed = key.trim()
  if (!trimmed) return null
  const hinted = PREFIX_RULES.find((rule) => rule.pattern.test(trimmed))
  const pool = hinted ? candidates.filter((candidate) => candidate.id === hinted.providerID) : candidates
  for (const candidate of pool) {
    const modelCount = await tryCandidate(candidate, trimmed)
    if (modelCount !== null) {
      return { providerID: candidate.id, name: candidate.name, modelCount }
    }
  }
  return null
}
