/**
 * 本机推理接入（A-29-2）。
 *
 * 背景：指标 29「免费可用性」是四指标中唯一弱于 Claude Code 的 —— CC 的短板是
 * 「起步要钱」，gyc-code 的短板是「想不花钱只能碰网络运气」。后者更糟，因为网络
 * 免费额度不稳定，而 CC 用户至少能用订阅覆盖。
 *
 * 补上本机推理后，gyc-code 用户可以「彻底永久免费」，这是把指标 29 从「中」推到
 * 「超越」的唯一路径。
 *
 * 复用既有设施，不另造轮子：
 *  - OpenAI 兼容 SDK 已在 `OpenAICompatiblePlugin` 就位（core/plugin/provider/openai-compatible.ts）
 *  - 运行时模型探测走 `CustomDiscoverModels`（provider.ts:113），gitlab 已有先例
 *  - 成本恒 0 + `priced: false` 的语义已由 provider.ts:1029-1033 的注释确立：
 *    「本机推理不计费」与「云端价格未知」是两件事，不得混为一谈
 */

import type { Model } from "./provider"

/** Ollama 默认端点 */
export const DEFAULT_BASE_URL = "http://localhost:11434/v1"

/** Ollama 原生 API（未经 OpenAI 兼容层）的 tags 端点 */
export const TAGS_URL = "http://localhost:11434/api/tags"

/** 只取模型标识所需的最小形状，避免依赖 Ollama 完整响应结构 */
type TagsResponse = { models?: Array<{ name?: unknown }> | unknown }

/**
 * 把 Ollama `/api/tags` 响应解析成 Model 表。
 *
 * 故意做成纯函数：HTTP 调用留在 loader 里，解析逻辑可独立测试，
 * 且响应畸形时返回空表而非抛出——本机没装 Ollama 是常态，不是错误。
 */
export function parseOllamaTags(raw: unknown): Record<string, Model> {
  const response = raw as TagsResponse | null
  const list = response?.models
  if (!Array.isArray(list)) return {}

  const models: Record<string, Model> = {}
  for (const entry of list) {
    const id = (entry as { name?: unknown } | null)?.name
    if (typeof id !== "string" || id.length === 0) continue
    models[id] = {
      id: id as Model["id"],
      providerID: "ollama" as Model["providerID"],
      api: { id: "ollama", url: DEFAULT_BASE_URL, npm: "@ai-sdk/openai-compatible" },
      name: id,
      cost: { input: 0, output: 0, cache: { read: 0, write: 0 } },
      // 本机推理不产生外部费用。priced=false 明确表达「不计费」而非「价格未知」。
      priced: false,
      capabilities: {
        temperature: true,
        reasoning: false,
        attachment: false,
        toolcall: true,
        input: { text: true, audio: false, image: false, video: false, pdf: false },
        output: { text: true, audio: false, image: false, video: false, pdf: false },
        interleaved: false,
      },
      limit: { context: 8192, output: 4096 },
      status: "active",
      options: {},
      headers: {},
      release_date: new Date(0).toISOString().slice(0, 10),
    }
  }
  return models
}

/**
 * 探测本机已安装的 Ollama 模型。未安装/未启动时返回空表，不抛异常——
 * 这是正常使用路径，不是错误。
 */
export async function discoverOllamaModels(baseURL = TAGS_URL): Promise<Record<string, Model>> {
  try {
    const response = await fetch(baseURL, { signal: AbortSignal.timeout(2000) })
    if (!response.ok) return {}
    return parseOllamaTags(await response.json())
  } catch {
    return {}
  }
}