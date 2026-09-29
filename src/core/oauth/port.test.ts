// OAuth 回调端口配置回归测试：确保环境变量出口生效，
// 且非法输入（NaN / 越界 / 空串）一律回落默认值，绝不产生 NaN 端口。
import { afterEach, beforeEach, describe, expect, it } from "bun:test"
import { digitalOceanCallbackPort, mcpOAuthCallbackPort, openAiCallbackPort } from "./port"

const KEYS = ["GYCCODE_OPENAI_OAUTH_PORT", "GYCCODE_DIGITALOCEAN_OAUTH_PORT", "GYCCODE_MCP_OAUTH_PORT"] as const
const saved = new Map<string, string | undefined>()

beforeEach(() => {
  for (const key of KEYS) {
    saved.set(key, process.env[key])
    delete process.env[key]
  }
})

afterEach(() => {
  for (const key of KEYS) {
    const value = saved.get(key)
    if (value === undefined) delete process.env[key]
    else process.env[key] = value
  }
})

describe("OAuth 回调端口", () => {
  it("未配置时使用默认值", () => {
    expect(openAiCallbackPort()).toBe(1455)
    expect(digitalOceanCallbackPort()).toBe(1456)
    expect(mcpOAuthCallbackPort()).toBe(19876)
  })

  it("环境变量覆盖生效", () => {
    process.env.GYCCODE_OPENAI_OAUTH_PORT = "9001"
    process.env.GYCCODE_DIGITALOCEAN_OAUTH_PORT = "9002"
    process.env.GYCCODE_MCP_OAUTH_PORT = "9003"
    expect(openAiCallbackPort()).toBe(9001)
    expect(digitalOceanCallbackPort()).toBe(9002)
    expect(mcpOAuthCallbackPort()).toBe(9003)
  })

  it("非法输入回落默认值而非 NaN", () => {
    for (const bad of ["abc", "NaN", "", "   ", "-1", "0", "70000", "1.5"]) {
      process.env.GYCCODE_OPENAI_OAUTH_PORT = bad
      expect(openAiCallbackPort()).toBe(1455)
    }
  })
})
