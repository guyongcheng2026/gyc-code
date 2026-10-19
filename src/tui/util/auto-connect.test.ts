import { afterEach, expect, test } from "bun:test"
import { detectProvider, type AutoConnectCandidate } from "./auto-connect"

const candidates: AutoConnectCandidate[] = [
  { id: "deepseek", name: "DeepSeek", url: "https://api.deepseek.com/v1", npm: "@ai-sdk/openai-compatible" },
  { id: "openrouter", name: "OpenRouter", url: "https://openrouter.ai/api/v1", npm: "@openrouter/ai-sdk-provider" },
  { id: "anthropic", name: "Anthropic", url: "https://api.anthropic.com/v1", npm: "@ai-sdk/anthropic" },
]

const originalFetch = globalThis.fetch
afterEach(() => {
  globalThis.fetch = originalFetch
})

type Call = { url: string; headers: Record<string, string> }

function mockFetch(handler: (call: Call, index: number) => { ok: boolean; body?: unknown }) {
  const calls: Call[] = []
  globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
    const call: Call = { url: String(input), headers: { ...(init?.headers as Record<string, string>) } }
    calls.push(call)
    const result = handler(call, calls.length - 1)
    return new Response(result.ok ? JSON.stringify(result.body ?? {}) : "{}", {
      status: result.ok ? 200 : 401,
    })
  }) as typeof fetch
  return calls
}

test("sk-or- 前缀短路：只请求 openrouter，不触碰其他厂商", async () => {
  const calls = mockFetch(() => ({ ok: true, body: { data: [{ id: "a" }, { id: "b" }] } }))
  const result = await detectProvider("sk-or-v1-abc", candidates)
  expect(result).toEqual({ providerID: "openrouter", name: "OpenRouter", modelCount: 2 })
  expect(calls).toHaveLength(1)
  expect(calls[0]?.url).toBe("https://openrouter.ai/api/v1/models")
})

test("无特征密钥：首家 401 后继续试探，命中即停", async () => {
  const calls = mockFetch((_call, index) => ({ ok: index === 1, body: { data: [{ id: "m1" }] } }))
  const result = await detectProvider("sk-some-key", candidates)
  expect(result?.providerID).toBe("openrouter")
  expect(calls).toHaveLength(2)
  expect(calls[0]?.url).toBe("https://api.deepseek.com/v1/models")
})

test("全部候选失败返回 null", async () => {
  mockFetch(() => ({ ok: false }))
  expect(await detectProvider("sk-some-key", candidates)).toBeNull()
})

test("空密钥不发请求", async () => {
  const calls = mockFetch(() => ({ ok: true }))
  expect(await detectProvider("   ", candidates)).toBeNull()
  expect(calls).toHaveLength(0)
})

test("anthropic 候选用 x-api-key 鉴权头", async () => {
  const calls = mockFetch(() => ({ ok: true, body: { data: [] } }))
  const result = await detectProvider("sk-ant-api3-abc", candidates)
  expect(result?.providerID).toBe("anthropic")
  expect(calls[0]?.headers["x-api-key"]).toBe("sk-ant-api3-abc")
  expect(calls[0]?.headers["Authorization"]).toBeUndefined()
})

test("google 风格 models 字段与 0 模型均可命中", async () => {
  const google: AutoConnectCandidate[] = [
    { id: "google", name: "Google", url: "https://generativelanguage.googleapis.com/v1beta", npm: "@ai-sdk/google" },
  ]
  const calls = mockFetch(() => ({ ok: true, body: { models: [{ name: "m" }] } }))
  const result = await detectProvider("AIza-sy-key", google)
  expect(result).toEqual({ providerID: "google", name: "Google", modelCount: 1 })
  expect(calls[0]?.headers["x-goog-api-key"]).toBe("AIza-sy-key")
})
