// 验证 external 后从项目根运行能否解析 provider
const m = await import("@ai-sdk/anthropic")
const n = await import("@ai-sdk/google-vertex/anthropic")
const o = await import("@ai-sdk/openai")
console.log("anthropic:", typeof m.createAnthropic)
console.log("vertex:", typeof n.createVertexAnthropic)
console.log("openai:", typeof o.createOpenAI)