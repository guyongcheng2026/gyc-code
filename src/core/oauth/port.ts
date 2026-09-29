// OAuth 回调端口的统一配置入口。
//
// 此前各 provider 各自硬编码端口（1455/1456/19876），既无法在端口冲突时调整，
// 也让排查"回调没到"变得困难。集中到此后：每个端口都有专属环境变量出口，
// 默认值保持不变以兼容既有 OAuth 应用注册（redirect_uri 必须与注册值一致）。
//
// 放在 core 包：core 侧的 provider/openai.ts 与 gyccode 侧的 plugin/* 都要用，
// 下沉到 core 才能避免下层依赖上层。
import { z } from "zod"

// 端口取值域，供配置校验层复用
export const PortSchema = z.number().int().min(1).max(65535)

/** 解析端口：非数字、越界一律回落到默认值，绝不产生 NaN 端口。 */
function port(value: string | undefined, fallback: number): number {
  if (value === undefined || value.trim().length === 0) return fallback
  const parsed = Number(value)
  if (!Number.isInteger(parsed) || parsed < 1 || parsed > 65535) return fallback
  return parsed
}

/** ChatGPT / OpenAI OAuth 回调端口。 */
export function openAiCallbackPort(): number {
  return port(process.env.GYCCODE_OPENAI_OAUTH_PORT, 1455)
}

/** DigitalOcean OAuth 回调端口。 */
export function digitalOceanCallbackPort(): number {
  return port(process.env.GYCCODE_DIGITALOCEAN_OAUTH_PORT, 1456)
}

/** MCP OAuth 回调端口。 */
export function mcpOAuthCallbackPort(): number {
  return port(process.env.GYCCODE_MCP_OAUTH_PORT, 19876)
}
